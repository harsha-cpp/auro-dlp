import { Router } from 'express';
import { getDb, audit } from '../db/index.js';
import { signPolicy } from '../services/signing.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const r = Router();

// Agent endpoint: download active signed bundle. mTLS in production.
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

// Operator: list versions
r.get('/', requireAuth, (_req, res) => {
  const rows = getDb().prepare(
    'SELECT version, created_at, active FROM policies ORDER BY id DESC LIMIT 50'
  ).all();
  res.json(rows);
});

// Operator: publish a new bundle. The version must be unique; signing key must be present.
r.post('/', requireAuth, requireRole('admin', 'security'), (req, res) => {
  const { version, yaml } = req.body || {};
  if (!version || !yaml) return res.status(400).json({ error: 'missing_fields' });
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
  audit(req.user.email, 'policy.updated', version, { bytes: yaml.length });
  res.json({ ok: true, version, signature: sig });
});

export default r;
