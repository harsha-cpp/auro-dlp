// AURO-DLP — endpoint agent main.
//
// Listens on 127.0.0.1:7443 (TLS, mTLS in production) for the Chrome / Edge
// extension. Performs file parsing, OCR, hybrid PHI/PII detection, and policy
// evaluation. Logs incidents locally and forwards metadata to the central
// policy server.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/auro/auro-dlp/endpoint-agent/internal/api"
	"github.com/auro/auro-dlp/endpoint-agent/internal/audit"
	"github.com/auro/auro-dlp/endpoint-agent/internal/config"
	"github.com/auro/auro-dlp/endpoint-agent/internal/detector"
	"github.com/auro/auro-dlp/endpoint-agent/internal/policy"
	"github.com/auro/auro-dlp/endpoint-agent/internal/tamper"
)

const Version = "1.0.0"

func main() {
	var (
		showVersion = flag.Bool("version", false, "print version and exit")
		configPath  = flag.String("config", defaultConfigPath(), "path to agent config YAML")
		listen      = flag.String("listen", "127.0.0.1:7443", "address to listen on")
		insecure    = flag.Bool("insecure", false, "disable TLS (development only)")
		runOnce     = flag.String("scan", "", "scan a single file path and exit (CLI mode)")
	)
	flag.Parse()

	if *showVersion {
		fmt.Printf("auro-agent %s (%s/%s)\n", Version, runtime.GOOS, runtime.GOARCH)
		return
	}

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	det, err := detector.New(cfg.DetectorConfigPath())
	if err != nil {
		log.Fatalf("detector: %v", err)
	}
	pol, err := policy.New(cfg.PolicyPath(), cfg.PolicyPubKey)
	if err != nil {
		log.Fatalf("policy: %v", err)
	}
	aud, err := audit.New(cfg.AuditPath())
	if err != nil {
		log.Fatalf("audit: %v", err)
	}

	// CLI single-shot mode (useful for tests and triage)
	if *runOnce != "" {
		runScanOnce(*runOnce, det, pol)
		return
	}

	// Tamper protection: self-hash check (best effort)
	if err := tamper.SelfCheck(); err != nil {
		log.Printf("tamper warning: %v", err)
	}

	srv := api.NewServer(api.Options{
		Listen:   *listen,
		Insecure: *insecure,
		Detector: det,
		Policy:   pol,
		Audit:    aud,
		Version:  Version,
	})

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("auro-agent %s listening on %s (insecure=%v)", Version, *listen, *insecure)
		if err := srv.Start(ctx); err != nil {
			log.Fatalf("server: %v", err)
		}
	}()

	// Periodic policy refresh
	go pol.RefreshLoop(ctx, cfg.PolicyServerURL, 15*time.Minute)

	<-ctx.Done()
	log.Printf("shutting down…")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}

func runScanOnce(path string, det *detector.Detector, pol *policy.Engine) {
	data, err := os.ReadFile(path)
	if err != nil {
		log.Fatalf("read: %v", err)
	}
	res := det.InspectText(string(data))
	verdict := pol.Evaluate(res)
	fmt.Printf("file: %s\n", path)
	fmt.Printf("risk: %.2f  verdict: %s\n", res.Risk, verdict.Verdict)
	for _, m := range res.Matches {
		fmt.Printf("  - %-12s x%d  first@%d\n", m.RuleID, m.Count, m.FirstOffset)
	}
	if len(verdict.Warnings) > 0 {
		fmt.Println("warnings:")
		for _, w := range verdict.Warnings {
			fmt.Printf("  • %s\n", w)
		}
	}
}

func defaultConfigPath() string {
	if runtime.GOOS == "windows" {
		return filepath.Join(os.Getenv("ProgramData"), "AURO-DLP", "agent.yaml")
	}
	return "/etc/auro-dlp/agent.yaml"
}
