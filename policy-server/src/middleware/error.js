import crypto from 'node:crypto';

export function errorHandler(err, req, res, _next) {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  console.error(JSON.stringify({
    requestId,
    error: err.message,
    stack: err.stack,
    method: req.method,
    path: req.path,
  }));
  if (res.headersSent) return;
  const status = err.status || 500;
  if (process.env.NODE_ENV === 'production') {
    res.status(status).json({ error: 'internal_error', request_id: requestId });
  } else {
    res.status(status).json({ error: err.code || 'internal', message: err.message, request_id: requestId });
  }
}
