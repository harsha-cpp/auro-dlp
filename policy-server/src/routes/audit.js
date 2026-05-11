import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const r = Router();

r.get('/', requireAuth, requireRole('admin', 'security', 'auditor'), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  res.json(getDb().prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(limit));
});

export default r;
