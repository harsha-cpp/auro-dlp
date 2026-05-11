export function errorHandler(err, _req, res, _next) {
  console.error('[err]', err);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: err.code || 'internal', message: err.message });
}
