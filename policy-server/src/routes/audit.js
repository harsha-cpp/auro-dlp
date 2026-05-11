import { Router } from 'express';
import { getDb, verifyChain } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const r = Router();

r.get('/', requireAuth, requireRole('admin', 'security', 'auditor'), (req, res) => {
  const pageSize = Math.min(Number(req.query.pageSize) || 200, 1000);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const offset = (page - 1) * pageSize;
  const { action, actor, from, to } = req.query;

  const where = [];
  const args = [];
  if (action) { where.push('action = ?'); args.push(action); }
  if (actor) { where.push('actor = ?'); args.push(actor); }
  if (from) { where.push("ts >= ?"); args.push(from); }
  if (to) { where.push("ts <= ?"); args.push(to); }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = getDb().prepare(`SELECT COUNT(*) AS n FROM audit ${whereClause}`).get(...args).n;
  const rows = getDb().prepare(
    `SELECT * FROM audit ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...args, pageSize, offset);

  let chainVerified = false;
  if (rows.length > 0 && rows[0].hmac !== undefined) {
    const ordered = [...rows].reverse();
    chainVerified = verifyChain(ordered);
  }

  res.json({ rows, total, chainVerified });
});

export default r;
