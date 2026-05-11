import { Router } from 'express';
import crypto from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { getDb, audit } from '../db/index.js';
import { requireAuth, requireRole, requireAgentToken } from '../middleware/auth.js';

const r = Router();
const TTL_MS = 5 * 60 * 1000;

const agentRateMap = new Map();
const AGENT_RATE_LIMIT = 60;
const AGENT_RATE_WINDOW = 60_000;

function checkAgentRate(tokenHash) {
  const now = Date.now();
  let entry = agentRateMap.get(tokenHash);
  if (!entry || now - entry.start > AGENT_RATE_WINDOW) {
    entry = { start: now, count: 0 };
    agentRateMap.set(tokenHash, entry);
  }
  entry.count++;
  return entry.count <= AGENT_RATE_LIMIT;
}

r.post('/override', requireAuth, requireRole('admin', 'security'), (req, res) => {
  const { incident_id, reason } = req.body || {};
  if (!incident_id) return res.status(400).json({ error: 'missing_incident_id' });
  const totp = ('' + crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const totpHash = crypto.createHash('sha256').update(totp).digest('hex');
  const overrideId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
  getDb().prepare(`
    INSERT INTO overrides (override_id, incident_id, issued_by, totp_hash, reason, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(overrideId, incident_id, req.user.uid, totpHash, reason || null, expiresAt);
  audit(req.user.email, 'incident.override.mint', incident_id, { override_id: overrideId });
  res.json({ totp, override_id: overrideId, expires_at: expiresAt });
});

r.post('/override/verify', requireAgentToken, (req, res) => {
  if (!checkAgentRate(req.agentTokenHash)) {
    return res.status(429).json({ error: 'rate_limit_exceeded' });
  }

  const { incident_id, totp } = req.body || {};
  if (!incident_id || !totp) return res.status(400).json({ error: 'missing_fields' });

  const incident = getDb().prepare('SELECT override_locked FROM incidents WHERE incident_id = ?').get(incident_id);
  if (incident?.override_locked) {
    return res.status(403).json({ approved: false, error: 'override_locked' });
  }

  const failCount = getDb().prepare(
    "SELECT COUNT(*) AS n FROM audit WHERE action = 'incident.override.deny' AND target = ?"
  ).get(incident_id).n;
  if (failCount >= 3) {
    getDb().prepare('UPDATE incidents SET override_locked = 1 WHERE incident_id = ?').run(incident_id);
    return res.status(403).json({ approved: false, error: 'override_locked' });
  }

  const totpHash = crypto.createHash('sha256').update(totp).digest('hex');
  const row = getDb().prepare(`
    SELECT * FROM overrides
    WHERE incident_id = ? AND totp_hash = ? AND consumed_at IS NULL
      AND expires_at > datetime('now')
  `).get(incident_id, totpHash);

  if (!row) {
    audit(req.agentEndpointId, 'incident.override.deny', incident_id);
    return res.status(401).json({ approved: false });
  }

  getDb().prepare('UPDATE overrides SET consumed_at = datetime("now") WHERE id = ?').run(row.id);
  audit(req.agentEndpointId, 'incident.override.consume', incident_id, { override_id: row.override_id });

  const ts = Date.now().toString();
  let signature = '';
  try {
    const keyPath = process.env.SIGNING_KEY_PATH || './certs/policy-ed25519.key';
    if (existsSync(keyPath)) {
      const key = crypto.createPrivateKey(readFileSync(keyPath));
      signature = crypto.sign(null, Buffer.from(incident_id + ts), key).toString('base64');
    }
  } catch {}

  res.json({ approved: true, override_id: row.override_id, signature, ts });
});

export default r;
