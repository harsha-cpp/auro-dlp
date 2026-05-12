import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { migrateDb } from './db/migrate.js';
import authRoutes from './routes/auth.js';
import policyRoutes from './routes/policies.js';
import incidentRoutes from './routes/incidents.js';
import agentRoutes from './routes/agents.js';
import auditRoutes from './routes/audit.js';
import overrideRoutes from './routes/override.js';
import adminRoutes from './routes/admin.js';
import streamRoutes from './routes/stream.js';
import { requestLogger } from './middleware/log.js';
import { errorHandler } from './middleware/error.js';
import { getSiemStatus } from './services/siem.js';

const app = express();
const port = Number(process.env.PORT || 8443);

await migrateDb();

const defaultOrigins = 'http://localhost:5173,http://127.0.0.1:5173';
const origins = (process.env.ALLOWED_ORIGINS || (process.env.NODE_ENV === 'production' ? '' : defaultOrigins))
  .split(',')
  .filter(Boolean);

if (process.env.NODE_ENV === 'production' && origins.length === 0) {
  console.warn('[WARN] ALLOWED_ORIGINS not set in production — CORS will reject all cross-origin requests');
}

app.disable('x-powered-by');
app.use(cors({ origin: origins, credentials: true }));
app.use(express.json({ limit: '512kb' }));
app.use(cookieParser());
app.use(requestLogger);

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'auro-policy', version: '1.0.0', siem: getSiemStatus() });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/policies', policyRoutes);
app.use('/api/v1/incidents', incidentRoutes);
app.use('/api/v1/agents', agentRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/admin', overrideRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/stream', streamRoutes);

app.use(errorHandler);

app.listen(port, () => {
  console.log(`[auro-policy] listening on :${port}`);
});
