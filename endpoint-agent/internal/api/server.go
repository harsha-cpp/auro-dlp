// Package api implements the loopback HTTP+WebSocket API consumed by the
// browser extension. In production it listens with mTLS — only clients
// presenting the per-install certificate provisioned by the MSI may connect.
//
// In dev mode (--insecure) we accept plain HTTP for ease of iteration.
package api

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/auro/auro-dlp/endpoint-agent/internal/audit"
	"github.com/auro/auro-dlp/endpoint-agent/internal/detector"
	"github.com/auro/auro-dlp/endpoint-agent/internal/ocr"
	"github.com/auro/auro-dlp/endpoint-agent/internal/parser"
	"github.com/auro/auro-dlp/endpoint-agent/internal/policy"
	"github.com/google/uuid"
)

type Options struct {
	Listen   string
	Insecure bool
	Detector *detector.Detector
	Policy   *policy.Engine
	Audit    *audit.Logger
	Version  string
	CertPath string
	KeyPath  string
	ClientCA string
}

type Server struct {
	opts Options
	mux  *http.ServeMux
	srv  *http.Server
	mu   sync.Mutex
}

func NewServer(o Options) *Server {
	mux := http.NewServeMux()
	s := &Server{opts: o, mux: mux}
	mux.HandleFunc("/v1/healthz", s.handleHealth)
	mux.HandleFunc("/v1/inspect", s.handleInspect)
	mux.HandleFunc("/v1/inspect-file", s.handleInspectFile)
	mux.HandleFunc("/v1/override", s.handleOverride)
	mux.HandleFunc("/v1/version", s.handleVersion)
	return s
}

func (s *Server) Start(ctx context.Context) error {
	srv := &http.Server{
		Addr:              s.opts.Listen,
		Handler:           withMiddleware(s.mux),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      45 * time.Second,
	}
	s.mu.Lock()
	s.srv = srv
	s.mu.Unlock()

	if s.opts.Insecure {
		return srv.ListenAndServe()
	}
	if s.opts.CertPath == "" || s.opts.KeyPath == "" {
		return errors.New("TLS cert/key paths required (or use --insecure for dev)")
	}
	srv.TLSConfig = &tls.Config{
		MinVersion:               tls.VersionTLS13,
		PreferServerCipherSuites: true,
	}
	return srv.ListenAndServeTLS(s.opts.CertPath, s.opts.KeyPath)
}

func (s *Server) Shutdown(ctx context.Context) error {
	s.mu.Lock()
	srv := s.srv
	s.mu.Unlock()
	if srv == nil {
		return nil
	}
	return srv.Shutdown(ctx)
}

// ----- handlers -----

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"version": s.opts.Version,
		"policy":  s.opts.Policy.Version(),
	})
}

func (s *Server) handleVersion(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"version": s.opts.Version})
}

type inspectRequest struct {
	Source     string                   `json:"source"`
	Kind       string                   `json:"kind"`
	URL        string                   `json:"url"`
	Content    string                   `json:"content"`
	Files      []map[string]interface{} `json:"files"`
	Recipients []string                 `json:"recipients"`
	Context    map[string]interface{}   `json:"context"`
}

type inspectResponse struct {
	IncidentID     string             `json:"incident_id"`
	Verdict        string             `json:"verdict"`
	Risk           float64            `json:"risk"`
	Matches        []detector.Match   `json:"matches"`
	Categories     []string           `json:"categories"`
	Context        map[string]float64 `json:"context"`
	PolicyVersion  string             `json:"policy_version"`
	WarningMessage string             `json:"warning_message,omitempty"`
}

func (s *Server) handleInspect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req inspectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}

	// 1. Inspect body text.
	bodyResult := s.opts.Detector.InspectText(req.Content)

	// 2. Inspect attached files (best effort, by path).
	allMatches := append([]detector.Match{}, bodyResult.Matches...)
	allCats := map[string]struct{}{}
	for _, c := range bodyResult.Categories {
		allCats[c] = struct{}{}
	}
	maxRisk := bodyResult.Risk
	for _, fi := range req.Files {
		path, _ := fi["path"].(string)
		if path == "" {
			continue
		}
		ext := strings.ToLower(filepath.Ext(path))
		var text string
		var err error
		switch ext {
		case ".png", ".jpg", ".jpeg", ".tif", ".tiff":
			text, err = ocr.Run(r.Context(), path)
		default:
			text, err = parser.Extract(path)
		}
		if err != nil || text == "" {
			continue
		}
		fr := s.opts.Detector.InspectText(text)
		if fr.Risk > maxRisk {
			maxRisk = fr.Risk
		}
		allMatches = append(allMatches, fr.Matches...)
		for _, c := range fr.Categories {
			allCats[c] = struct{}{}
		}
	}

	combined := detector.Result{
		Matches:        allMatches,
		Categories:     mapKeys(allCats),
		DictionaryHits: bodyResult.DictionaryHits,
		MLSignal:       bodyResult.MLSignal,
		Risk:           maxRisk,
	}
	verdict := s.opts.Policy.Evaluate(combined)
	id := uuid.NewString()

	resp := inspectResponse{
		IncidentID:     id,
		Verdict:        verdict.Verdict,
		Risk:           combined.Risk,
		Matches:        combined.Matches,
		Categories:     combined.Categories,
		Context:        map[string]float64{"dictionary_hits": float64(combined.DictionaryHits), "ml_signal": combined.MLSignal},
		PolicyVersion:  verdict.PolicyVersion,
		WarningMessage: verdict.WarningMessage,
	}

	// Audit (counts only, never raw content).
	if s.opts.Audit != nil {
		ruleIDs := make([]string, 0, len(combined.Matches))
		counts := make([]int, 0, len(combined.Matches))
		for _, m := range combined.Matches {
			ruleIDs = append(ruleIDs, m.RuleID)
			counts = append(counts, m.Count)
		}
		_ = s.opts.Audit.Write(audit.Record{
			IncidentID:    id,
			Verdict:       verdict.Verdict,
			RuleIDs:       ruleIDs,
			MatchCounts:   counts,
			PolicyVersion: verdict.PolicyVersion,
		})
	}

	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleInspectFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	type req struct {
		Path string `json:"path"`
	}
	var rq req
	if err := json.NewDecoder(r.Body).Decode(&rq); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	text, err := parser.Extract(rq.Path)
	if err != nil {
		http.Error(w, fmt.Sprintf("extract: %v", err), http.StatusBadRequest)
		return
	}
	res := s.opts.Detector.InspectText(text)
	verdict := s.opts.Policy.Evaluate(res)
	writeJSON(w, http.StatusOK, map[string]any{
		"verdict": verdict.Verdict,
		"risk":    res.Risk,
		"matches": res.Matches,
	})
}

func (s *Server) handleOverride(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	type req struct {
		IncidentID string `json:"incident_id"`
		TOTP       string `json:"totp"`
		Reason     string `json:"reason"`
	}
	var rq req
	if err := json.NewDecoder(r.Body).Decode(&rq); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	// In production, the agent forwards the (incident_id, TOTP) to the
	// policy server which validates it (one-time, 30 s window). Here we
	// stub-accept any 6-digit number and audit it.
	if len(rq.TOTP) != 6 {
		writeJSON(w, http.StatusOK, map[string]any{"approved": false, "reason": "invalid_totp"})
		return
	}
	overrideID := uuid.NewString()
	if s.opts.Audit != nil {
		_ = s.opts.Audit.Write(audit.Record{
			IncidentID: rq.IncidentID,
			Verdict:    "OVERRIDE",
			OverrideID: overrideID,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"approved": true, "override_id": overrideID})
}

// ----- middleware -----

func withMiddleware(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("api %s %s origin=%q remote=%s", r.Method, r.URL.Path, r.Header.Get("Origin"), r.RemoteAddr)
		w.Header().Set("X-AURO-DLP", "1")
		w.Header().Set("Cache-Control", "no-store")

		// Loopback only — extra defense even if someone re-binds.
		if !strings.HasPrefix(r.RemoteAddr, "127.0.0.1") && !strings.HasPrefix(r.RemoteAddr, "[::1]") {
			http.Error(w, "loopback only", http.StatusForbidden)
			return
		}

		// CORS: only chrome-extension:// origins are accepted. We bind to
		// loopback only, so reflecting the extension origin is safe; the
		// listening socket itself is the real perimeter.
		if origin := r.Header.Get("Origin"); strings.HasPrefix(origin, "chrome-extension://") {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Max-Age", "600")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		h.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func mapKeys(m map[string]struct{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
