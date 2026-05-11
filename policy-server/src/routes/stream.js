import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { eventBus } from '../services/events.js';

const r = Router();

r.get('/', requireAuth, (req, res) => {
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
