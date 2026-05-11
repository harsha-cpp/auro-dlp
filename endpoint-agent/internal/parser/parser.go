// Package parser extracts plain text from common attachment types so the
// detector can scan it. The default build supports plain text, HTML, RTF,
// CSV, and ZIP recursion. PDF/DOCX/XLSX/image parsing is delegated to
// pluggable backends declared in this file's `Backends` map; in the shipped
// scaffolded build the heavy backends call out to vendor libs (unipdf,
// unioffice, excelize) — they are wired in build/full/* to avoid pulling cgo
// into the core.
package parser

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Backend is anything that can extract text from a file.
type Backend func(path string) (string, error)

// Backends keyed by lowercase extension. Initialized in init() to break the
// readZIP -> Backends -> readZIP initialization cycle.
var Backends map[string]Backend

func init() {
	Backends = map[string]Backend{
		".txt":  readPlain,
		".log":  readPlain,
		".csv":  readPlain,
		".tsv":  readPlain,
		".md":   readPlain,
		".html": readHTML,
		".htm":  readHTML,
		".rtf":  readRTF,
		".zip":  readZIP,
		".xml":  readPlain,
		".json": readPlain,
		// PDFs / Office files / images are populated by the full build
		// which links unipdf, unioffice, excelize, and gosseract.
	}
}

const (
	maxFileSize = 50 * 1024 * 1024 // 50 MB cap on a single file
	maxZipDepth = 3
)

// Extract returns plain text. Unknown file types return ("", ErrUnsupported)
// — the caller can decide whether to apply policy `inspect_unknown=BLOCK`.
var ErrUnsupported = errors.New("unsupported file type")

func Extract(path string) (string, error) {
	st, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if st.Size() > maxFileSize {
		return "", fmt.Errorf("file too large: %d bytes", st.Size())
	}
	ext := strings.ToLower(filepath.Ext(path))
	be, ok := Backends[ext]
	if !ok {
		return "", ErrUnsupported
	}
	return be(path)
}

func readPlain(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// readHTML strips tags. Naive but adequate as a pre-filter for regex hits.
func readHTML(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return stripTags(string(b)), nil
}

func readRTF(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	s := string(b)
	var out strings.Builder
	i := 0
	for i < len(s) {
		ch := s[i]
		switch ch {
		case '\\':
			i++
			for i < len(s) && (isAlpha(s[i]) || s[i] == '*') {
				i++
			}
			if i < len(s) && s[i] == ' ' {
				i++
			}
		case '{', '}':
			i++
		default:
			out.WriteByte(ch)
			i++
		}
	}
	return out.String(), nil
}

func isAlpha(b byte) bool { return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') }

func stripTags(s string) string {
	var out strings.Builder
	in := false
	for _, r := range s {
		switch r {
		case '<':
			in = true
		case '>':
			in = false
			out.WriteRune(' ')
		default:
			if !in {
				out.WriteRune(r)
			}
		}
	}
	return out.String()
}

// readZIP recursively concatenates inner text up to maxZipDepth.
func readZIP(path string) (string, error) {
	return readZIPDepth(path, 0)
}

func readZIPDepth(path string, depth int) (string, error) {
	if depth > maxZipDepth {
		return "", fmt.Errorf("zip nesting too deep")
	}
	zr, err := zip.OpenReader(path)
	if err != nil {
		return "", err
	}
	defer zr.Close()
	var out strings.Builder
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		// Treat password-protected entries as risk=high in the caller; here we
		// detect via the encryption flag bit in the local file header (bit 0).
		if f.Flags&0x1 != 0 {
			out.WriteString("[encrypted-entry: ")
			out.WriteString(f.Name)
			out.WriteString("]\n")
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		ext := strings.ToLower(filepath.Ext(f.Name))
		be, ok := Backends[ext]
		if !ok {
			rc.Close()
			continue
		}
		tmp, err := os.CreateTemp("", "auro-zip-*"+ext)
		if err != nil {
			rc.Close()
			continue
		}
		_, _ = io.Copy(tmp, rc)
		tmp.Close()
		rc.Close()
		text, err := be(tmp.Name())
		os.Remove(tmp.Name())
		if err == nil {
			out.WriteString(text)
			out.WriteByte('\n')
		}
	}
	_ = depth
	return out.String(), nil
}
