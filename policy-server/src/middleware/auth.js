import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { getDb } from '../db/index.js';

const JWT_SECRET = (() => {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET !== 'dev-secret-change-me') {
    return process.env.JWT_SECRET;
  }
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET env var must be set in production');
    process.exit(1);
  }
  const s = crypto.randomBytes(32).toString('hex');
  console.warn('[WARN] JWT_SECRET not set — using random ephemeral secret (dev only)');
  return s;
})();

export const REFRESH_SECRET = JWT_SECRET + ':refresh';

export { JWT_SECRET };

export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'unauthenticated' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.jti) {
      const denied = getDb().prepare('SELECT jti FROM token_denylist WHERE jti = ?').get(payload.jti);
      if (denied) return res.status(401).json({ error: 'token_revoked' });
    }
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden', need: roles });
    next();
  };
}

export function requireAgentToken(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing_agent_token' });
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const row = getDb().prepare('SELECT endpoint_id FROM agent_tokens WHERE token_hash = ?').get(tokenHash);
  if (!row) return res.status(401).json({ error: 'invalid_agent_token' });
  req.agentEndpointId = row.endpoint_id;
  req.agentTokenHash = tokenHash;
  next();
}
