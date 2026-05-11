import { Router } from 'express';
import { getDb, audit } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { forwardSiem } from '../services/siem.js';
import { eventBus } from '../services/events.js';

const r = Router();

r.post('/', (req, res) => {
  const i = req.body || {};
  if (!i.incident_id || !i.endpoint_id || !i.verdict) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  try {
    getDb().prepare(`
      INSERT OR IGNORE INTO incidents
      (incident_id, endpoint_id, user_principal, verdict, risk, rule_ids,
       match_counts, categories, attachment_hashes, recipient_domain_hashes,
       policy_version, override_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      i.incident_id, i.endpoint_id, i.user_principal || null, i.verdict,
      i.risk || null,
      JSON.stringify(i.rule_ids || []),
      JSON.stringify(i.match_counts || []),
      JSON.stringify(i.categories || []),
      JSON.stringify(i.attachment_hashes || []),
      JSON.stringify(i.recipient_domain_hashes || []),
      i.policy_version || null,
      i.override_id || null,
    );
  } catch (e) {
    return res.status(500).json({ error: 'db_write', message: e.message });
  }
  audit('agent:' + i.endpoint_id, 'incident.create', i.incident_id, { verdict: i.verdict });
  forwardSiem('incident.created', i).catch(() => {});
  eventBus.emit('event', { type: 'incident.created', data: { incident_id: i.incident_id, verdict: i.verdict } });
  res.status(201).json({ ok: true });
});

r.get('/', requireAuth, (req, res) => {
  const pageSize = Math.min(Number(req.query.pageSize) || 50, 500);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const offset = (page - 1) * pageSize;
  const { verdict, q, from, to } = req.query;

  const where = [];
  const args = [];

  if (verdict) { where.push('verdict = ?'); args.push(verdict); }
  if (from) { where.push("ts >= ?"); args.push(from); }
  if (to) { where.push("ts <= ?"); args.push(to); }
  if (q) {
    where.push("(user_principal LIKE ? OR endpoint_id LIKE ? OR rule_ids LIKE ?)");
    const like = `%${q}%`;
    args.push(like, like, like);
  }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = getDb().prepare(`SELECT COUNT(*) AS n FROM incidents ${whereClause}`).get(...args).n;
  const rows = getDb().prepare(
    `SELECT * FROM incidents ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...args, pageSize, offset);

  res.json({ rows, total });
});

r.get('/export', requireAuth, requireRole('admin', 'security', 'auditor'), (req, res) => {
  const { verdict, q, from, to } = req.query;
  const where = [];
  const args = [];
  if (verdict) { where.push('verdict = ?'); args.push(verdict); }
  if (from) { where.push("ts >= ?"); args.push(from); }
  if (to) { where.push("ts <= ?"); args.push(to); }
  if (q) {
    where.push("(user_principal LIKE ? OR endpoint_id LIKE ? OR rule_ids LIKE ?)");
    const like = `%${q}%`;
    args.push(like, like, like);
  }
  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = getDb().prepare(`SELECT * FROM incidents ${whereClause} ORDER BY id DESC`).all(...args);

  const date = new Date().toISOString().split('T')[0];
  res.set({
    'Content-Type': 'text/csv',
    'Content-Disposition': `attachment; filename="incidents-${date}.csv"`,
  });

  const header = 'incident_id,ts,endpoint_id,user_principal,verdict,risk,rule_ids,categories,policy_version\n';
  res.write(header);
  for (const row of rows) {
    const line = [
      row.incident_id,
      row.ts,
      row.endpoint_id,
      row.user_principal || '',
      row.verdict,
      row.risk ?? '',
      (row.rule_ids || '').replace(/,/g, ';'),
      (row.categories || '').replace(/,/g, ';'),
      row.policy_version || '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    res.write(line + '\n');
  }
  res.end();
});

r.get('/stats', requireAuth, (_req, res) => {
  const db = getDb();
  const endpointsTotal = db.prepare('SELECT COUNT(*) AS n FROM endpoints').get().n;
  const endpointsOnline = db.prepare(
    `SELECT COUNT(*) AS n FROM endpoints WHERE last_seen IS NOT NULL AND datetime(last_seen) >= datetime('now', '-5 minutes')`
  ).get().n;
  const incidents24h = db.prepare(`SELECT COUNT(*) AS n FROM incidents WHERE datetime(ts) >= datetime('now', '-1 day')`).get().n;
  const blocked24h = db.prepare(
    `SELECT COUNT(*) AS n FROM incidents WHERE datetime(ts) >= datetime('now', '-1 day') AND verdict IN ('BLOCK', 'HARD_BLOCK')`
  ).get().n;
  const policy = db.prepare('SELECT version, signature FROM policies WHERE active = 1').get();
  const activePolicy = policy?.version ?? null;
  const activePolicySigned = !!(policy?.signature && policy.signature.length > 0);

  const trendRows = db.prepare(
    `SELECT date(ts) AS day, COUNT(*) AS incidents, SUM(CASE WHEN verdict IN ('BLOCK','HARD_BLOCK') THEN 1 ELSE 0 END) AS blocks FROM incidents WHERE date(ts) >= date('now', '-13 days') GROUP BY date(ts) ORDER BY day ASC`
  ).all();
  const trendByDay = new Map(trendRows.map(r => [r.day, r]));
  const trend = [];
  for (let i = 13; i >= 0; i--) {
    const day = db.prepare(`SELECT date('now', ?) AS d`).get(`-${i} days`).d;
    const row = trendByDay.get(day);
    trend.push({ day: day.slice(5), incidents: row?.incidents ?? 0, blocks: row?.blocks ?? 0 });
  }
  const byVerdict = db.prepare(`SELECT verdict, COUNT(*) AS count FROM incidents GROUP BY verdict ORDER BY count DESC`).all();
  const catRows = db.prepare(`SELECT categories FROM incidents WHERE categories IS NOT NULL`).all();
  const catCounts = new Map();
  for (const row of catRows) {
    try {
      const cats = JSON.parse(row.categories);
      if (Array.isArray(cats)) for (const c of cats) catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
    } catch {}
  }
  const byCategory = [...catCounts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count).slice(0, 10);

  res.json({ endpointsTotal, endpointsOnline, incidents24h, blocked24h, activePolicy, activePolicySigned, trend, byVerdict, byCategory });
});

r.get('/:incident_id', requireAuth, (req, res) => {
  const row = getDb().prepare('SELECT * FROM incidents WHERE incident_id = ?').get(req.params.incident_id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(row);
});

export default r;
