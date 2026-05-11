import { Router } from 'express';
import { getDb, audit } from '../db/index.js';
import { signPolicy } from '../services/signing.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { eventBus } from '../services/events.js';

const r = Router();

r.get('/current', (req, res) => {
  const p = getDb().prepare('SELECT version, yaml, signature FROM policies WHERE active = 1').get();
  if (!p) return res.status(404).json({ error: 'no_active_policy' });
  if (req.headers['if-none-match'] === p.version) return res.status(304).end();
  res.set({
    'Content-Type': 'application/yaml; charset=utf-8',
    'ETag': p.version,
    'X-Signature': p.signature,
  });
  res.send(p.yaml);
});

r.get('/', requireAuth, (_req, res) => {
  const rows = getDb().prepare(
    'SELECT id, version, created_at, active, yaml, signature FROM policies ORDER BY id DESC LIMIT 50'
  ).all();
  const policies = rows.map(r => ({ ...r, bundle: r.yaml }));
  res.json({ policies });
});

r.post('/', requireAuth, requireRole('admin', 'security'), (req, res) => {
  let { version, yaml, bundle } = req.body || {};
  if (bundle && !yaml) yaml = bundle;
  if (!yaml) return res.status(400).json({ error: 'missing_fields' });
  if (!version) {
    const match = yaml.match(/version:\s*["']?([^"'\n]+)/);
    version = match ? match[1].trim() : `v-${Date.now()}`;
  }
  let sig;
  try { sig = signPolicy(yaml); }
  catch (e) { return res.status(500).json({ error: 'signing_failed', message: e.message }); }
  const tx = getDb().transaction(() => {
    getDb().prepare('UPDATE policies SET active = 0').run();
    getDb().prepare(
      'INSERT INTO policies (version, yaml, signature, created_by, active) VALUES (?, ?, ?, ?, 1)'
    ).run(version, yaml, sig, req.user.uid);
  });
  try { tx(); } catch (e) { return res.status(409).json({ error: 'version_exists' }); }
  audit(req.user.email, 'policy.publish', version, { bytes: yaml.length });
  eventBus.emit('event', { type: 'policy.published', data: { version } });
  res.json({ ok: true, version, signature: sig });
});

r.post('/:id/activate', requireAuth, requireRole('admin', 'security'), (req, res) => {
  const { id } = req.params;
  const policy = getDb().prepare('SELECT * FROM policies WHERE id = ? OR version = ?').get(id, id);
  if (!policy) return res.status(404).json({ error: 'not_found' });
  const tx = getDb().transaction(() => {
    getDb().prepare('UPDATE policies SET active = 0').run();
    getDb().prepare('UPDATE policies SET active = 1 WHERE id = ?').run(policy.id);
  });
  tx();
  audit(req.user.email, 'policy.activate', policy.version);
  eventBus.emit('event', { type: 'policy.published', data: { version: policy.version } });
  res.json({ ok: true, version: policy.version });
});

export default r;
