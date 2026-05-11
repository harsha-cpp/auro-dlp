import { Router } from 'express';
import { getDb, audit } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { eventBus } from '../services/events.js';

const r = Router();

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
  eventBus.emit('event', { type: 'agent.online', data: { endpoint_id } });
  res.json({ ok: true });
});

r.post('/extension-heartbeat', (req, res) => {
  const { endpoint_id, ext_version } = req.body || {};
  if (!endpoint_id) return res.status(400).json({ error: 'missing_endpoint' });
  getDb().prepare(`
    INSERT INTO endpoints (endpoint_id, version, ext_present, last_seen)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(endpoint_id) DO UPDATE SET ext_present = 1, last_seen = datetime('now')
  `).run(endpoint_id, ext_version || null);
  res.json({ ok: true });
});

r.get('/', requireAuth, (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM endpoints ORDER BY last_seen DESC').all();
  const agents = rows.map(row => {
    const lastSeen = row.last_seen;
    const isOnline = lastSeen && (Date.now() - new Date(lastSeen + 'Z').getTime()) < 5 * 60 * 1000;
    return {
      id: row.id,
      endpoint_id: row.endpoint_id,
      hostname: row.hostname,
      user: row.user_principal,
      os: null,
      agentVersion: row.version,
      policyVersion: row.policy_version,
      lastSeen: row.last_seen,
      status: isOnline ? 'online' : 'offline',
      isolated: !!(row.isolated),
      ext_present: row.ext_present,
    };
  });
  res.json({ agents });
});

r.post('/:id/isolate', requireAuth, requireRole('admin', 'security'), (req, res) => {
  const { id } = req.params;
  const endpoint = getDb().prepare('SELECT * FROM endpoints WHERE id = ? OR endpoint_id = ?').get(id, id);
  if (!endpoint) return res.status(404).json({ error: 'not_found' });
  getDb().prepare('UPDATE endpoints SET isolated = 1 WHERE id = ?').run(endpoint.id);
  audit(req.user.email, 'agent.isolate', endpoint.endpoint_id);
  res.json({ ok: true });
});

export default r;
