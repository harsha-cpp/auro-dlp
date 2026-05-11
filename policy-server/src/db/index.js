import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AUDIT_HMAC_KEY = process.env.AUDIT_HMAC_KEY || crypto.randomBytes(32).toString('hex');

let db;

export function getDb() {
  if (!db) {
    const path = process.env.DB_PATH || join(__dirname, '..', '..', 'auro.db');
    db = new Database(path);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function initDb() {
  const d = getDb();
  d.exec(`
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
  `);
}

export function audit(actor, action, target, detail) {
  const d = getDb();
  const prevHash = d.prepare('SELECT hmac FROM audit ORDER BY id DESC LIMIT 1').get()?.hmac || '';
  const ts = Date.now();
  const detailStr = detail ? JSON.stringify(detail) : null;
  const payload = JSON.stringify({ actor, action, target, detail, ts, prev_hash: prevHash });
  const hmac = crypto.createHmac('sha256', AUDIT_HMAC_KEY).update(payload).digest('hex');
  try {
    d.prepare(
      'INSERT INTO audit (actor, action, target, detail, ts, prev_hash, hmac) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(actor, action, target || null, detailStr, new Date(ts).toISOString(), prevHash, hmac);
  } catch {
    d.prepare(
      'INSERT INTO audit (actor, action, target, detail) VALUES (?, ?, ?, ?)'
    ).run(actor, action, target || null, detailStr);
  }
}

export function verifyChain(rows) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.hmac) return false;
    const expectedPrev = i === 0 ? '' : rows[i - 1].hmac;
    if (row.prev_hash !== expectedPrev) return false;
    const detail = row.detail ? JSON.parse(row.detail) : row.detail;
    const payload = JSON.stringify({
      actor: row.actor,
      action: row.action,
      target: row.target,
      detail,
      ts: new Date(row.ts).getTime(),
      prev_hash: row.prev_hash,
    });
    const computed = crypto.createHmac('sha256', AUDIT_HMAC_KEY).update(payload).digest('hex');
    if (computed !== row.hmac) return false;
  }
  return true;
}

export { AUDIT_HMAC_KEY };
