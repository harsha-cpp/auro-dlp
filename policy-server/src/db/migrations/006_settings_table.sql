CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  siem_hec_url TEXT DEFAULT '',
  siem_syslog_url TEXT DEFAULT '',
  siem_webhook_url TEXT DEFAULT '',
  retention_days INTEGER DEFAULT 90,
  override_ttl_minutes INTEGER DEFAULT 5,
  allowed_origins TEXT DEFAULT 'http://localhost:5173',
  updated_at TEXT DEFAULT (datetime('now'))
)
