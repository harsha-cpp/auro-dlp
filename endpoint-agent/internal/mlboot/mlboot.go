package mlboot

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

type Manifest struct {
	ModelID    string            `json:"model_id"`
	Version   string            `json:"version"`
	SHA256    string            `json:"sha256"`
	SizeBytes int64             `json:"size_bytes"`
	Files     map[string]string `json:"files"`
	OnnxRT    map[string]string `json:"onnxruntime"`

	LocalModelDir  string `json:"-"`
	LocalORTPath   string `json:"-"`
}

func Bootstrap(ctx context.Context, serverURL, dataDir string) (*Manifest, error) {
	manifest, err := fetchManifest(ctx, serverURL)
	if err != nil {
		return nil, fmt.Errorf("fetch manifest: %w", err)
	}

	modelDir := filepath.Join(dataDir, "models", manifest.ModelID, manifest.Version)
	if err := os.MkdirAll(modelDir, 0755); err != nil {
		return nil, err
	}

	for fileName, urlPath := range manifest.Files {
		localPath := filepath.Join(modelDir, fileName)
		if fileExists(localPath) {
			continue
		}
		dlURL := strings.TrimRight(serverURL, "/") + urlPath
		if err := downloadFile(ctx, dlURL, localPath); err != nil {
			return nil, fmt.Errorf("download %s: %w", fileName, err)
		}
	}

	if manifest.SHA256 != "" && manifest.SHA256 != "unavailable" {
		onnxPath := filepath.Join(modelDir, "model.onnx")
		if actual, err := fileSHA256(onnxPath); err == nil && actual != manifest.SHA256 {
			return nil, fmt.Errorf("model.onnx checksum mismatch: got %s want %s", actual, manifest.SHA256)
		}
	}

	manifest.LocalModelDir = modelDir

	ortPath, err := ensureORT(ctx, manifest, dataDir)
	if err != nil {
		return manifest, fmt.Errorf("ort runtime: %w (continuing without ML)", err)
	}
	manifest.LocalORTPath = ortPath

	return manifest, nil
}

func fetchManifest(ctx context.Context, serverURL string) (*Manifest, error) {
	url := strings.TrimRight(serverURL, "/") + "/api/v1/models/manifest"
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("manifest returned %d", resp.StatusCode)
	}
	var m Manifest
	return &m, json.NewDecoder(resp.Body).Decode(&m)
}

func ensureORT(ctx context.Context, m *Manifest, dataDir string) (string, error) {
	platform := runtime.GOOS + "-" + runtime.GOARCH
	platformKey := platform
	if platform == "darwin-arm64" {
		platformKey = "darwin-arm64"
	} else if platform == "linux-amd64" {
		platformKey = "linux-amd64"
	} else {
		return "", fmt.Errorf("unsupported platform: %s", platform)
	}

	ext := "so"
	if runtime.GOOS == "darwin" {
		ext = "dylib"
	}
	libName := "libonnxruntime." + ext

	runtimeDir := filepath.Join(dataDir, "runtime")
	libPath := filepath.Join(runtimeDir, libName)
	if fileExists(libPath) {
		return libPath, nil
	}

	tgzURL, ok := m.OnnxRT[platformKey]
	if !ok {
		return "", fmt.Errorf("no ORT URL for %s", platformKey)
	}

	if err := os.MkdirAll(runtimeDir, 0755); err != nil {
		return "", err
	}

	tmpFile := libPath + ".tmp.tgz"
	if err := downloadFile(ctx, tgzURL, tmpFile); err != nil {
		return "", err
	}
	defer os.Remove(tmpFile)

	if err := extractLibFromTgz(tmpFile, libName, libPath); err != nil {
		return "", err
	}

	return libPath, nil
}

func downloadFile(ctx context.Context, url, dest string) error {
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d for %s", resp.StatusCode, url)
	}

	tmpDest := dest + ".tmp"
	f, err := os.Create(tmpDest)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		os.Remove(tmpDest)
		return err
	}
	f.Close()
	return os.Rename(tmpDest, dest)
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

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
