-- Initial schema (already exists via initDb, but captured for completeness)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','security','auditor','helpdesk')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS endpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id TEXT UNIQUE NOT NULL,
  hostname TEXT,
  user_principal TEXT,
  version TEXT,
  policy_version TEXT,
  ext_present INTEGER DEFAULT 0,
  last_seen TEXT,
  enrolled_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id TEXT UNIQUE NOT NULL,
  endpoint_id TEXT NOT NULL,
  user_principal TEXT,
  verdict TEXT NOT NULL,
  risk REAL,
  rule_ids TEXT,
  match_counts TEXT,
  categories TEXT,
  attachment_hashes TEXT,
  recipient_domain_hashes TEXT,
  policy_version TEXT,
  override_id TEXT,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  override_id TEXT UNIQUE NOT NULL,
  incident_id TEXT NOT NULL,
  issued_by INTEGER NOT NULL REFERENCES users(id),
  totp_hash TEXT NOT NULL,
  reason TEXT,
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT UNIQUE NOT NULL,
  yaml TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER REFERENCES users(id),
  active INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_incidents_ts ON incidents(ts);
CREATE INDEX IF NOT EXISTS idx_incidents_endpoint ON incidents(endpoint_id);
CREATE INDEX IF NOT EXISTS idx_incidents_verdict ON incidents(verdict);
