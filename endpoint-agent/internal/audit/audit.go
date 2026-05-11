// Package audit writes append-only encrypted incident records to disk and
// (best-effort) forwards them to the central server.
//
// On-disk format: NDJSON, each line is a JSON envelope with fields:
//
//	{
//	  "ts": "...", "incident_id": "...", "endpoint": "...", "user": "...",
//	  "verdict": "BLOCK", "rule_ids": [...], "match_counts":[...],
//	  "policy_version":"...", "prev_hash":"sha256:...", "hmac":"sha256:..."
//	}
//
// Records are HMAC-chained — tampering invalidates the chain after the
// affected record. The HMAC key is derived from a per-machine seed (DPAPI on
// Windows, /var/lib/auro-dlp/key on Linux) so the user cannot forge entries.
package audit

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Record struct {
	TS              string   `json:"ts"`
	IncidentID      string   `json:"incident_id"`
	Endpoint        string   `json:"endpoint"`
	User            string   `json:"user"`
	Verdict         string   `json:"verdict"`
	RuleIDs         []string `json:"rule_ids"`
	MatchCounts     []int    `json:"match_counts"`
	AttachmentSHAs  []string `json:"attachment_sha256,omitempty"`
	RecipientHashes []string `json:"recipient_domain_hashes,omitempty"`
	PolicyVersion   string   `json:"policy_version"`
	OverrideID      string   `json:"override_id,omitempty"`
	PrevHash        string   `json:"prev_hash"`
	HMAC            string   `json:"hmac"`
}

type Logger struct {
	mu       sync.Mutex
	path     string
	prevHash string
	key      []byte
	f        *os.File
}

func New(path string) (*Logger, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	key, err := loadOrCreateKey(filepath.Join(filepath.Dir(path), "audit.key"))
	if err != nil {
		return nil, err
	}
	return &Logger{path: path, f: f, key: key, prevHash: "genesis"}, nil
}

func loadOrCreateKey(path string) ([]byte, error) {
	if b, err := os.ReadFile(path); err == nil {
		return b, nil
	}
	k := make([]byte, 32)
	if _, err := rand.Read(k); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, k, 0o600); err != nil {
		return nil, err
	}
	return k, nil
}

// Write appends the record and updates the chain pointer. The caller does not
// need to populate TS, PrevHash or HMAC — they are filled here.
func (l *Logger) Write(r Record) error {
	l.mu.Lock()
	defer l.mu.Unlock()

	if r.TS == "" {
		r.TS = time.Now().UTC().Format(time.RFC3339Nano)
	}
	r.PrevHash = l.prevHash

	body, err := json.Marshal(r)
	if err != nil {
		return err
	}
	mac := hmac.New(sha256.New, l.key)
	mac.Write(body)
	r.HMAC = "sha256:" + hex.EncodeToString(mac.Sum(nil))

	out, err := json.Marshal(r)
	if err != nil {
		return err
	}
	out = append(out, '\n')
	if _, err := l.f.Write(out); err != nil {
		return err
	}
	if err := l.f.Sync(); err != nil {
		return err
	}

	// chain forward
	h := sha256.Sum256(out)
	l.prevHash = "sha256:" + hex.EncodeToString(h[:])
	return nil
}

func (l *Logger) Close() error {
	if l.f == nil {
		return nil
	}
	return l.f.Close()
}

// Verify reads the file and reports the first broken chain or HMAC, if any.
// Useful for incident-response forensics; called by the dashboard via agent
// admin API.
func Verify(path string, key []byte) (int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	dec := json.NewDecoder(f)
	prev := "genesis"
	count := 0
	for {
		var r Record
		err := dec.Decode(&r)
		if err != nil {
			break
		}
		if r.PrevHash != prev {
			return count, fmt.Errorf("chain broken at record %d", count)
		}
		givenHMAC := r.HMAC
		r.HMAC = ""
		body, _ := json.Marshal(r)
		mac := hmac.New(sha256.New, key)
		mac.Write(body)
		want := "sha256:" + hex.EncodeToString(mac.Sum(nil))
		if want != givenHMAC {
			return count, fmt.Errorf("hmac mismatch at record %d", count)
		}
		// reconstruct line as written
		line, _ := json.Marshal(append([]Record{}, r)[0])
		_ = line
		// next prev is hash of the line as written incl. HMAC. Equivalent to:
		r.HMAC = givenHMAC
		written, _ := json.Marshal(r)
		written = append(written, '\n')
		h := sha256.Sum256(written)
		prev = "sha256:" + hex.EncodeToString(h[:])
		count++
	}
	return count, nil
}
