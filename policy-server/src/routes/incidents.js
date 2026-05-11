import { Router } from 'express';
import { getDb, audit } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { forwardSiem } from '../services/siem.js';

const r = Router();

// Agent ingest. mTLS-authenticated in production.
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
  forwardSiem('incident.created', i).catch((e) => console.warn('siem fwd:', e.message));
  res.status(201).json({ ok: true });
});

// Operator listing.
r.get('/', requireAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const verdict = req.query.verdict;
  const where = [];
  const args = [];
  if (verdict) { where.push('verdict = ?'); args.push(verdict); }
  const sql = `SELECT * FROM incidents
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY id DESC LIMIT ?`;
  args.push(limit);
  res.json(getDb().prepare(sql).all(...args));
});

// Aggregated stats for the operator overview. MUST be declared before /:incident_id
// so Express does not treat "stats" as an incident id.
r.get('/stats', requireAuth, (_req, res) => {
  const db = getDb();

  const endpointsTotal = db.prepare('SELECT COUNT(*) AS n FROM endpoints').get().n;
  const endpointsOnline = db.prepare(
    `SELECT COUNT(*) AS n FROM endpoints
     WHERE last_seen IS NOT NULL
       AND datetime(last_seen) >= datetime('now', '-5 minutes')`
  ).get().n;

  const incidents24h = db.prepare(
    `SELECT COUNT(*) AS n FROM incidents WHERE datetime(ts) >= datetime('now', '-1 day')`
  ).get().n;
  const blocked24h = db.prepare(
    `SELECT COUNT(*) AS n FROM incidents
     WHERE datetime(ts) >= datetime('now', '-1 day')
       AND verdict IN ('BLOCK', 'HARD_BLOCK')`
  ).get().n;

  const policy = db.prepare('SELECT version, signature FROM policies WHERE active = 1').get();
  const activePolicy = policy?.version ?? null;
  const activePolicySigned = !!(policy?.signature && policy.signature.length > 0);

  const trendRows = db.prepare(
    `SELECT date(ts) AS day,
            COUNT(*) AS incidents,
            SUM(CASE WHEN verdict IN ('BLOCK','HARD_BLOCK') THEN 1 ELSE 0 END) AS blocks
       FROM incidents
      WHERE date(ts) >= date('now', '-13 days')
      GROUP BY date(ts)
      ORDER BY day ASC`
  ).all();
  const trendByDay = new Map(trendRows.map(r => [r.day, r]));
  const trend = [];
  for (let i = 13; i >= 0; i--) {
    const day = db.prepare(`SELECT date('now', ?) AS d`).get(`-${i} days`).d;
    const row = trendByDay.get(day);
    trend.push({ day: day.slice(5), incidents: row?.incidents ?? 0, blocks: row?.blocks ?? 0 });
  }

  const byVerdict = db.prepare(
    `SELECT verdict, COUNT(*) AS count FROM incidents GROUP BY verdict ORDER BY count DESC`
  ).all();

  // categories column stores a JSON array per row; flatten across rows for top-N.
  const catRows = db.prepare(`SELECT categories FROM incidents WHERE categories IS NOT NULL`).all();
  const catCounts = new Map();
  for (const row of catRows) {
    try {
      const cats = JSON.parse(row.categories);
      if (Array.isArray(cats)) {
        for (const c of cats) catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
      }
    } catch { /* malformed row */ }
  }
  const byCategory = [...catCounts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  res.json({
    endpointsTotal,
    endpointsOnline,
    incidents24h,
    blocked24h,
    activePolicy,
    activePolicySigned,
    trend,
    byVerdict,
    byCategory,
  });
});

r.get('/:incident_id', requireAuth, (req, res) => {
  const row = getDb().prepare('SELECT * FROM incidents WHERE incident_id = ?').get(req.params.incident_id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(row);
});

export default r;
