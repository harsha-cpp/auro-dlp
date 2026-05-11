import { Router } from 'express';
import bcrypt from 'bcrypt';
import { getDb, audit } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getSiemStatus } from '../services/siem.js';

const r = Router();

r.get('/settings', requireAuth, requireRole('admin', 'security'), (_req, res) => {
  let settings;
  try {
    settings = getDb().prepare('SELECT * FROM settings WHERE id = 1').get();
  } catch {
    settings = {};
  }
  const siemStatus = getSiemStatus();
  res.json({
    siem: {
      hec_url: settings?.siem_hec_url || process.env.SIEM_HEC_URL || '',
      syslog_url: settings?.siem_syslog_url || process.env.SIEM_SYSLOG_URL || '',
      webhook_url: settings?.siem_webhook_url || process.env.SIEM_WEBHOOK_URL || '',
      status: siemStatus,
    },
    retention_days: settings?.retention_days ?? 90,
    override_ttl_minutes: settings?.override_ttl_minutes ?? 5,
    allowed_origins: settings?.allowed_origins || process.env.ALLOWED_ORIGINS || '',
  });
});

r.put('/settings', requireAuth, requireRole('admin'), (req, res) => {
  const { siem_hec_url, siem_syslog_url, siem_webhook_url, retention_days, override_ttl_minutes, allowed_origins } = req.body || {};
  try {
    getDb().prepare(`
      UPDATE settings SET
        siem_hec_url = COALESCE(?, siem_hec_url),
        siem_syslog_url = COALESCE(?, siem_syslog_url),
        siem_webhook_url = COALESCE(?, siem_webhook_url),
        retention_days = COALESCE(?, retention_days),
        override_ttl_minutes = COALESCE(?, override_ttl_minutes),
        allowed_origins = COALESCE(?, allowed_origins),
        updated_at = datetime('now')
      WHERE id = 1
    `).run(
      siem_hec_url ?? null,
      siem_syslog_url ?? null,
      siem_webhook_url ?? null,
      retention_days ?? null,
      override_ttl_minutes ?? null,
      allowed_origins ?? null
    );
  } catch (e) {
    return res.status(500).json({ error: 'db_error', message: e.message });
  }
  audit(req.user.email, 'settings.update', null, req.body);
  res.json({ ok: true });
});

r.get('/users', requireAuth, requireRole('admin', 'security'), (_req, res) => {
  const users = getDb().prepare('SELECT id, email, role, created_at, last_login FROM users').all();
  res.json({ users });
});

r.post('/users', requireAuth, requireRole('admin'), async (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password || !role) return res.status(400).json({ error: 'missing_fields' });
  if (!['admin', 'security', 'auditor', 'helpdesk'].includes(role)) {
    return res.status(400).json({ error: 'invalid_role' });
  }
  const hash = await bcrypt.hash(password, 12);
  try {
    getDb().prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)').run(email, hash, role);
  } catch (e) {
    return res.status(409).json({ error: 'user_exists' });
  }
  audit(req.user.email, 'rbac.user.create', email, { role });
  res.status(201).json({ ok: true });
});

r.patch('/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  const { id } = req.params;
  const { role, disabled } = req.body || {};
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'not_found' });

  if (role) {
    if (!['admin', 'security', 'auditor', 'helpdesk'].includes(role)) {
      return res.status(400).json({ error: 'invalid_role' });
    }
    getDb().prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }
  if (disabled !== undefined) {
    getDb().prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, id);
  }
  audit(req.user.email, 'rbac.user.update', user.email, { role, disabled });
  res.json({ ok: true });
});

r.delete('/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  const { id } = req.params;
  const user = getDb().prepare('SELECT email FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
  audit(req.user.email, 'rbac.user.delete', user.email);
  res.json({ ok: true });
});

export default r;
