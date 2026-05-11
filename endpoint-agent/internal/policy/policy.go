// Package policy loads and refreshes a signed YAML policy bundle from the
// central server. The policy decides verdict thresholds, per-category overrides,
// hard-block rules (e.g., Aadhaar = always BLOCK_NO_OVERRIDE), and warning
// templates.
package policy

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/auro/auro-dlp/endpoint-agent/internal/detector"
	"gopkg.in/yaml.v3"
)

type Verdict struct {
	Verdict        string   `json:"verdict"` // ALLOW | WARN | BLOCK | BLOCK_NO_OVERRIDE
	Risk           float64  `json:"risk"`
	WarningMessage string   `json:"warning_message,omitempty"`
	PolicyVersion  string   `json:"policy_version"`
	Warnings       []string `json:"warnings,omitempty"`
}

type Bundle struct {
	Version       string             `yaml:"version"`
	WarnAt        float64            `yaml:"warn_threshold"`
	BlockAt       float64            `yaml:"block_threshold"`
	HardBlock     []string           `yaml:"hard_block_rules"`
	HardBlockCats []string           `yaml:"hard_block_categories"`
	Messages      map[string]string  `yaml:"messages"`
	OverrideOK    map[string]bool    `yaml:"override_allowed"`
	RuleWeights   map[string]float64 `yaml:"rule_weights"`
}

type Engine struct {
	mu      sync.RWMutex
	bundle  *Bundle
	path    string
	pubKey  ed25519.PublicKey
	version string
}

// New loads the persisted bundle (if any) and verifies its signature with
// pubKeyB64. If the file is missing or invalid, a sane default is used.
func New(path string, pubKeyB64 string) (*Engine, error) {
	e := &Engine{path: path, bundle: defaultBundle()}
	if pubKeyB64 != "" {
		raw, err := base64.StdEncoding.DecodeString(pubKeyB64)
		if err != nil || len(raw) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("policy public key invalid")
		}
		e.pubKey = ed25519.PublicKey(raw)
	}
	if err := e.loadFromDisk(); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Printf("policy: %v (using defaults)", err)
	}
	return e, nil
}

func defaultBundle() *Bundle {
	return &Bundle{
		Version: "default-1.0",
		WarnAt:  0.30,
		BlockAt: 0.65,
		HardBlock: []string{
			"IN.AADHAAR",
		},
		HardBlockCats: []string{},
		Messages: map[string]string{
			"WARN":  "This message contains content that looks like sensitive patient data. Send only if absolutely necessary.",
			"BLOCK": "This message contains protected patient information. Sending externally is blocked by hospital policy.",
			"HARD":  "Aadhaar / regulated identifier detected — this transmission is blocked and cannot be overridden by you.",
		},
		OverrideOK: map[string]bool{
			"WARN":  true,
			"BLOCK": true,
		},
		RuleWeights: map[string]float64{},
	}
}

func (e *Engine) loadFromDisk() error {
	b, err := os.ReadFile(e.path)
	if err != nil {
		return err
	}
	// In production: verify Ed25519 detached signature stored beside the file.
	if e.pubKey != nil {
		sigPath := e.path + ".sig"
		sig, err := os.ReadFile(sigPath)
		if err == nil {
			if !ed25519.Verify(e.pubKey, b, sig) {
				return fmt.Errorf("policy signature invalid")
			}
		}
	}
	var bundle Bundle
	if err := yaml.Unmarshal(b, &bundle); err != nil {
		return err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.bundle = &bundle
	e.version = bundle.Version
	return nil
}

// Evaluate maps a detection result to a verdict using the active bundle.
func (e *Engine) Evaluate(r detector.Result) Verdict {
	e.mu.RLock()
	defer e.mu.RUnlock()
	b := e.bundle

	v := Verdict{Risk: r.Risk, PolicyVersion: b.Version}

	// 1. Hard blocks (uncoverable).
	hardRules := toSet(b.HardBlock)
	hardCats := toSet(b.HardBlockCats)
	hits := []string{}
	for _, m := range r.Matches {
		if hardRules[m.RuleID] || hardCats[m.Category] {
			hits = append(hits, m.RuleID)
		}
	}
	if len(hits) > 0 {
		sort.Strings(hits)
		v.Verdict = "BLOCK_NO_OVERRIDE"
		v.WarningMessage = b.Messages["HARD"]
		v.Warnings = hits
		return v
	}

	// 2. Threshold-based.
	switch {
	case r.Risk >= b.BlockAt:
		v.Verdict = "BLOCK"
		v.WarningMessage = b.Messages["BLOCK"]
	case r.Risk >= b.WarnAt:
		v.Verdict = "WARN"
		v.WarningMessage = b.Messages["WARN"]
	default:
		v.Verdict = "ALLOW"
	}
	return v
}

func (e *Engine) Version() string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.bundle.Version
}

// RefreshLoop fetches /api/v1/policies/current periodically (ETag-aware).
func (e *Engine) RefreshLoop(ctx context.Context, serverURL string, every time.Duration) {
	if serverURL == "" {
		return
	}
	t := time.NewTicker(every)
	defer t.Stop()
	var etag string
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			et, err := e.fetchOnce(serverURL, etag)
			if err != nil {
				log.Printf("policy refresh: %v", err)
				continue
			}
			if et != "" {
				etag = et
			}
		}
	}
}

func (e *Engine) fetchOnce(serverURL, etag string) (string, error) {
	req, err := http.NewRequest("GET", serverURL+"/policies/current", nil)
	if err != nil {
		return "", err
	}
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotModified {
		return etag, nil
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("server status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if e.pubKey != nil {
		sigB64 := resp.Header.Get("X-Signature")
		sig, err := base64.StdEncoding.DecodeString(sigB64)
		if err != nil || !ed25519.Verify(e.pubKey, body, sig) {
			return "", fmt.Errorf("policy signature invalid")
		}
	}
	if err := os.MkdirAll(filepath.Dir(e.path), 0o755); err != nil {
		return "", err
	}
	tmp := e.path + ".tmp"
	if err := os.WriteFile(tmp, body, 0o600); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, e.path); err != nil {
		return "", err
	}
	if err := e.loadFromDisk(); err != nil {
		return "", err
	}
	return resp.Header.Get("ETag"), nil
}

func toSet(xs []string) map[string]bool {
	m := make(map[string]bool, len(xs))
	for _, x := range xs {
		m[x] = true
	}
	return m
}
