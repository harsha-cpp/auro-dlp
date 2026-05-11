package config

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"

	"gopkg.in/yaml.v3"
)

// Config is the on-disk configuration for the agent. Values come from
// %ProgramData%\AURO-DLP\agent.yaml on Windows, /etc/auro-dlp/agent.yaml on Linux.
type Config struct {
	EndpointID      string `yaml:"endpoint_id"`
	PolicyServerURL string `yaml:"policy_server_url"`
	PolicyPubKey    string `yaml:"policy_public_key"` // base64 ed25519
	DataDir         string `yaml:"data_dir"`
	LogLevel        string `yaml:"log_level"`
	StrictMode      bool   `yaml:"strict_mode"`
}

// Load reads the YAML at path. If the file is missing, a sensible default is
// returned so the agent can start in dev mode.
func Load(path string) (*Config, error) {
	c := &Config{
		DataDir:    defaultDataDir(),
		LogLevel:   "info",
		StrictMode: true,
	}
	b, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return c, nil
		}
		return nil, err
	}
	if err := yaml.Unmarshal(b, c); err != nil {
		return nil, err
	}
	if c.DataDir == "" {
		c.DataDir = defaultDataDir()
	}
	return c, nil
}

func (c *Config) PolicyPath() string {
	return filepath.Join(c.DataDir, "policy.yaml")
}

func (c *Config) DetectorConfigPath() string {
	return filepath.Join(c.DataDir, "patterns.yaml")
}

func (c *Config) AuditPath() string {
	return filepath.Join(c.DataDir, "audit.ndjson")
}

func (c *Config) EnsureDataDir() error {
	if err := os.MkdirAll(c.DataDir, 0o750); err != nil {
		fallback, cacheErr := os.UserCacheDir()
		if cacheErr != nil {
			return err
		}
		c.DataDir = filepath.Join(fallback, "auro-dlp")
		return os.MkdirAll(c.DataDir, 0o750)
	}
	return nil
}

func defaultDataDir() string {
	if runtime.GOOS == "windows" {
		return filepath.Join(os.Getenv("ProgramData"), "AURO-DLP")
	}
	if d, err := os.UserCacheDir(); err == nil {
		return filepath.Join(d, "auro-dlp")
	}
	return "/var/lib/auro-dlp"
}
