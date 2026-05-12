import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { requireAuth, JWT_SECRET } from '../middleware/auth.js';
import { eventBus } from '../services/events.js';

const r = Router();

function authFromQuery(req, _res, next) {
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
}

r.get('/', authFromQuery, requireAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 10000\n\n');

  const handler = (event) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data || {})}\n\n`);
  };

  eventBus.on('event', handler);

  const keepAlive = setInterval(() => {
    res.write(': ping\n\n');
  }, 25_000);

  req.on('close', () => {
    eventBus.off('event', handler);
    clearInterval(keepAlive);
  });
});

export default r;
