export function requestLogger(req, res, next) {
  const start = Date.now();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  res.on('finish', () => {
    const dt = Date.now() - start;
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      ip,
      m: req.method,
      p: req.path,
      s: res.statusCode,
      dt,
    }));
  });
  next();
}
