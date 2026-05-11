import { Router } from 'express';
import { getDb, audit } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const r = Router();

// Heartbeat — agent.
r.post('/heartbeat', (req, res) => {
  const { endpoint_id, version, policy, ext_present, hostname, user_principal } = req.body || {};
  if (!endpoint_id) return res.status(400).json({ error: 'missing_endpoint' });
  getDb().prepare(`
    INSERT INTO endpoints (endpoint_id, hostname, user_principal, version, policy_version, ext_present, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(endpoint_id) DO UPDATE SET
      hostname = excluded.hostname,
      user_principal = excluded.user_principal,
      version = excluded.version,
      policy_version = excluded.policy_version,
      ext_present = excluded.ext_present,
      last_seen = excluded.last_seen
  `).run(endpoint_id, hostname || null, user_principal || null, version || null, policy || null, ext_present ? 1 : 0);
  res.json({ ok: true });
});

// Browser-extension heartbeat (so dashboard knows extension is alive even if agent is paused)
r.post('/extension-heartbeat', (req, res) => {
  const { endpoint_id, ext_version } = req.body || {};
  if (!endpoint_id) return res.status(400).json({ error: 'missing_endpoint' });
  getDb().prepare(`
    INSERT INTO endpoints (endpoint_id, version, ext_present, last_seen)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(endpoint_id) DO UPDATE SET
      ext_present = 1,
      last_seen = datetime('now')
  `).run(endpoint_id, ext_version || null);
  res.json({ ok: true });
});

// Operator listing
r.get('/', requireAuth, (_req, res) => {
  res.json(getDb().prepare('SELECT * FROM endpoints ORDER BY last_seen DESC').all());
});

export default r;
