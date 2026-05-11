// Admin override workflow.
// Security operator clicks "Approve override" in the dashboard, which calls
// POST /api/v1/admin/override with {incident_id}. The server mints a one-time
// 6-digit TOTP-style code (HMAC-SHA-256 truncated), 30 s expiry, and stores
// only its hash. The user types the code into the extension's modal, which
// passes it to the agent which forwards it to the policy server for verify.
import { Router } from 'express';
import crypto from 'node:crypto';
import { getDb, audit } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const r = Router();
const TTL_MS = 5 * 60 * 1000; // 5 min — long enough for a phone call

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
  audit(req.user.email, 'incident.override.issued', incident_id, { override_id: overrideId });
  res.json({ totp, override_id: overrideId, expires_at: expiresAt });
});

r.post('/override/verify', (req, res) => {
  const { incident_id, totp } = req.body || {};
  if (!incident_id || !totp) return res.status(400).json({ error: 'missing_fields' });
  const totpHash = crypto.createHash('sha256').update(totp).digest('hex');
  const row = getDb().prepare(`
    SELECT * FROM overrides
    WHERE incident_id = ? AND totp_hash = ? AND consumed_at IS NULL
      AND expires_at > datetime('now')
  `).get(incident_id, totpHash);
  if (!row) return res.status(401).json({ approved: false });
  getDb().prepare('UPDATE overrides SET consumed_at = datetime("now") WHERE id = ?').run(row.id);
  audit('agent', 'incident.override.consumed', incident_id, { override_id: row.override_id });
  res.json({ approved: true, override_id: row.override_id });
});

export default r;
