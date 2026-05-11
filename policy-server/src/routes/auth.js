import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { getDb, audit } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const r = Router();

r.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'missing_credentials' });
  const u = getDb().prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!u || !(await bcrypt.compare(password, u.password_hash))) {
    audit(email, 'auth.failure', null, { ip: req.ip });
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  const token = jwt.sign({ uid: u.id, email: u.email, role: u.role },
    process.env.JWT_SECRET || 'dev-secret', { expiresIn: '15m' });
  audit(u.email, 'auth.login', null);
  res.json({ token, role: u.role, email: u.email });
});

r.get('/me', requireAuth, (req, res) => res.json(req.user));

export default r;
