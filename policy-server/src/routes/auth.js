import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { getDb, audit } from '../db/index.js';
import { requireAuth, JWT_SECRET, REFRESH_SECRET } from '../middleware/auth.js';

const r = Router();

const isDev = process.env.NODE_ENV !== 'production';
const loginLimiter = rateLimit({ windowMs: 30_000, max: isDev ? 100 : 5, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 30_000, max: isDev ? 200 : 10, standardHeaders: true, legacyHeaders: false });

r.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'missing_credentials' });

  const u = getDb().prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!u || !(await bcrypt.compare(password, u.password_hash))) {
    audit(email, 'auth.failure', null, { ip: req.ip });
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  if (u.disabled) return res.status(403).json({ error: 'account_disabled' });

  const jti = crypto.randomUUID();
  const accessToken = jwt.sign(
    { uid: u.id, email: u.email, role: u.role, jti },
    JWT_SECRET,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    { uid: u.id, type: 'refresh' },
    REFRESH_SECRET,
    { expiresIn: '7d' }
  );

  res.cookie('auro_refresh', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/api/v1/auth',
  });

  getDb().prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(u.id);
  audit(u.email, 'auth.login', null);

  const mustChange = u.must_change_password === 1;
  res.json({
    access_token: accessToken,
    token: accessToken,
    role: u.role,
    email: u.email,
    ...(mustChange && { must_change_password: true }),
  });
});

r.post('/logout', requireAuth, (req, res) => {
  const jti = req.user.jti;
  if (jti) {
    const exp = req.user.exp || Math.floor(Date.now() / 1000) + 900;
    try {
      getDb().prepare('INSERT OR IGNORE INTO token_denylist (jti, expires_at) VALUES (?, ?)').run(jti, exp);
    } catch { /* table may not exist yet in edge case */ }
  }
  audit(req.user.email, 'auth.logout', null);
  res.clearCookie('auro_refresh', { path: '/api/v1/auth' });
  res.status(204).end();
});

r.post('/refresh', authLimiter, (req, res) => {
  const refreshToken = req.cookies?.auro_refresh;
  if (!refreshToken) return res.status(401).json({ error: 'no_refresh_token' });
  try {
    const payload = jwt.verify(refreshToken, REFRESH_SECRET);
    if (payload.type !== 'refresh') throw new Error('bad type');
    const u = getDb().prepare('SELECT id, email, role, disabled FROM users WHERE id = ?').get(payload.uid);
    if (!u || u.disabled) return res.status(401).json({ error: 'invalid_refresh' });

    const jti = crypto.randomUUID();
    const accessToken = jwt.sign(
      { uid: u.id, email: u.email, role: u.role, jti },
      JWT_SECRET,
      { expiresIn: '15m' }
    );
    res.json({ access_token: accessToken, token: accessToken });
  } catch {
    return res.status(401).json({ error: 'invalid_refresh_token' });
  }
});

r.post('/change-password', authLimiter, requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) return res.status(400).json({ error: 'missing_fields' });
  if (new_password.length < 12) return res.status(400).json({ error: 'password_too_short', min: 12 });

  const u = getDb().prepare('SELECT * FROM users WHERE id = ?').get(req.user.uid);
  if (!u || !(await bcrypt.compare(current_password, u.password_hash))) {
    return res.status(401).json({ error: 'invalid_current_password' });
  }

  const hash = await bcrypt.hash(new_password, 12);
  getDb().prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, u.id);
  audit(u.email, 'auth.password_change', null);
  res.json({ ok: true });
});

r.get('/me', requireAuth, (req, res) => res.json(req.user));

export default r;
