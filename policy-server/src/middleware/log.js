export function requestLogger(req, _res, next) {
  const start = Date.now();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  next();
  // Cheap structured log to stdout (pipe to systemd-journald in prod)
  const dt = Date.now() - start;
  console.log(JSON.stringify({ ts: new Date().toISOString(), ip, m: req.method, p: req.path, dt }));
}
