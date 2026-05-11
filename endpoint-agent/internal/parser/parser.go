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
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/ledongthuc/pdf"
)

type Backend func(path string) (string, error)

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
		".docx": readDOCX,
		".pptx": readPPTX,
		".xlsx": readXLSX,
		".pdf":  readPDF,
	}
}

const (
	maxFileSize       = 100 * 1024 * 1024 // 100 MiB
	maxDecompressed   = 500 * 1024 * 1024 // 500 MiB
	maxZipDepth       = 3
)

var ErrUnsupported = errors.New("unsupported file type")
var ErrEncrypted = errors.New("file is encrypted")

func Extract(path string) (string, error) {
	st, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if st.Size() > maxFileSize {
		return "", fmt.Errorf("file too large: %d bytes", st.Size())
	}
	// OLE encryption detection (Office binary formats)
	if isOLEEncrypted(path) {
		return "", ErrEncrypted
	}
	ext := strings.ToLower(filepath.Ext(path))
	be, ok := Backends[ext]
	if !ok {
		return "", ErrUnsupported
	}
	return be(path)
}

func isOLEEncrypted(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	magic := make([]byte, 8)
	if _, err := io.ReadFull(f, magic); err != nil {
		return false
	}
	// OLE2 magic: D0 CF 11 E0 A1 B1 1A E1
	return magic[0] == 0xD0 && magic[1] == 0xCF && magic[2] == 0x11 && magic[3] == 0xE0 &&
		magic[4] == 0xA1 && magic[5] == 0xB1 && magic[6] == 0x1A && magic[7] == 0xE1
}

func readPlain(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

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
	totalDecompressed := 0
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
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
		n, _ := io.Copy(tmp, io.LimitReader(rc, int64(maxDecompressed-totalDecompressed)))
		totalDecompressed += int(n)
		tmp.Close()
		rc.Close()
		text, err := be(tmp.Name())
		os.Remove(tmp.Name())
		if err == nil {
			out.WriteString(text)
			out.WriteByte('\n')
		}
		if totalDecompressed >= maxDecompressed {
			break
		}
	}
	return out.String(), nil
}

// readDOCX extracts text from <w:t> elements in word/document.xml.
func readDOCX(path string) (string, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return "", err
	}
	defer zr.Close()
	var out strings.Builder
	for _, f := range zr.File {
		if f.Name != "word/document.xml" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return "", err
		}
		text := extractXMLText(io.LimitReader(rc, int64(maxDecompressed)), "t")
		rc.Close()
		out.WriteString(text)
	}
	return out.String(), nil
}

// readPPTX extracts text from <a:t> elements in ppt/slides/slide*.xml.
func readPPTX(path string) (string, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return "", err
	}
	defer zr.Close()
	var out strings.Builder
	for _, f := range zr.File {
		if !strings.HasPrefix(f.Name, "ppt/slides/slide") || !strings.HasSuffix(f.Name, ".xml") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		text := extractXMLText(io.LimitReader(rc, int64(maxDecompressed)), "t")
		rc.Close()
		out.WriteString(text)
		out.WriteByte('\n')
	}
	return out.String(), nil
}

// readXLSX extracts text from xl/sharedStrings.xml <t> elements.
func readXLSX(path string) (string, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return "", err
	}
	defer zr.Close()
	var out strings.Builder
	for _, f := range zr.File {
		if f.Name != "xl/sharedStrings.xml" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return "", err
		}
		text := extractXMLText(io.LimitReader(rc, int64(maxDecompressed)), "t")
		rc.Close()
		out.WriteString(text)
	}
	return out.String(), nil
}

func extractXMLText(r io.Reader, localName string) string {
	dec := xml.NewDecoder(r)
	var out strings.Builder
	var inElement bool
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			inElement = t.Name.Local == localName
		case xml.EndElement:
			if t.Name.Local == localName {
				inElement = false
				out.WriteByte(' ')
			}
		case xml.CharData:
			if inElement {
				out.Write(t)
			}
		}
	}
	return out.String()
}

// readPDF extracts plain text from PDF files using a pure-Go parser.
func readPDF(path string) (string, error) {
	f, r, err := pdf.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	var b strings.Builder
	npages := r.NumPage()
	if npages > 200 {
		npages = 200 // cap pages to limit DoS
	}
	for i := 1; i <= npages; i++ {
		p := r.Page(i)
		if p.V.IsNull() {
			continue
		}
		text, err := p.GetPlainText(nil)
		if err != nil {
			continue
		}
		b.WriteString(text)
		b.WriteRune('\n')
		if b.Len() > 50*1024*1024 {
			break
		}
	}
	return b.String(), nil
}
