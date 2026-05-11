// Package ocr is a thin wrapper around the system Tesseract binary. It is a
// shell-out implementation so the core agent does not require cgo, which keeps
// cross-compilation to Windows simple. Production deployments install
// Tesseract 5 at install time (see deployment/windows-installer/install.ps1).
//
// If tesseract is not on PATH, OCR returns ErrUnavailable; the caller then
// applies the policy's `ocr_required=BLOCK` rule to refuse images on strict
// endpoints.
package ocr

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

var ErrUnavailable = errors.New("tesseract not available on PATH")

// Run extracts text from an image. Languages default to "eng+hin" (English +
// Hindi) — adequate for Indian hospital settings. Adjust via `langs`.
func Run(ctx context.Context, imagePath string, langs ...string) (string, error) {
	if _, err := exec.LookPath("tesseract"); err != nil {
		return "", ErrUnavailable
	}
	if len(langs) == 0 {
		langs = []string{"eng", "hin"}
	}
	if ctx == nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
	}

	tmp, err := os.MkdirTemp("", "auro-ocr-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tmp)
	outBase := filepath.Join(tmp, "out")

	args := []string{imagePath, outBase, "-l", strings.Join(langs, "+"), "--psm", "3", "--oem", "3"}
	cmd := exec.CommandContext(ctx, "tesseract", args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", err
	}
	b, err := os.ReadFile(outBase + ".txt")
	if err != nil {
		return "", err
	}
	return string(b), nil
}
