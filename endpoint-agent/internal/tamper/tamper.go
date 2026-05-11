// Package tamper implements lightweight self-integrity checks. The full
// production hardening lives in deployment/windows-installer/* and uses:
//
//   - Windows Service ACL (only LocalSystem can stop)
//   - FailureActions = restart on crash
//   - Sibling watchdog process (auro-watchdog.exe)
//   - SCM ACL via sc.exe sdset
//   - File ACL on %ProgramFiles%\AURO-DLP\ deny user write
//   - Code signing (EV cert) on the binary
//   - Sealed registry keys under HKLM\SOFTWARE\AURO-DLP
//
// At runtime we still want a cheap self-check so a tampered binary refuses to
// start and a tampered policy file is detected on every load. SelfCheck below
// computes the SHA-256 of the running executable and compares against an
// (optional) baseline file written by the installer.
package tamper

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

func SelfCheck() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return err
	}
	h, err := fileSHA256(exe)
	if err != nil {
		return err
	}
	baseline := baselinePath()
	want, err := os.ReadFile(baseline)
	if err != nil {
		// No baseline — first run; write it.
		_ = os.MkdirAll(filepath.Dir(baseline), 0o700)
		return os.WriteFile(baseline, []byte(h), 0o600)
	}
	if strings.TrimSpace(string(want)) != h {
		return fmt.Errorf("binary hash mismatch: have %s want %s", h[:12], string(want)[:12])
	}
	return nil
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func baselinePath() string {
	if runtime.GOOS == "windows" {
		return filepath.Join(os.Getenv("ProgramData"), "AURO-DLP", "selfhash.txt")
	}
	return "/var/lib/auro-dlp/selfhash.txt"
}
