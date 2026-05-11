// AURO-DLP — central policy server.
//
// Responsibilities:
//   - Distribute the active, Ed25519-signed policy bundle to agents.
//   - Ingest agent heartbeats and incident events.
//   - Operator API (JWT, RBAC) for the admin dashboard.
//   - Override TOTP minting + verification.
//   - SIEM forwarding (Splunk HEC / syslog / webhook).
//
// Storage: SQLite (better-sqlite3). The schema is portable to Postgres; swap
// the driver in src/db/index.js for a managed deployment.

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initDb } from './db/index.js';
import authRoutes from './routes/auth.js';
import policyRoutes from './routes/policies.js';
import incidentRoutes from './routes/incidents.js';
import agentRoutes from './routes/agents.js';
import auditRoutes from './routes/audit.js';
import overrideRoutes from './routes/override.js';
import { requestLogger } from './middleware/log.js';
import { errorHandler } from './middleware/error.js';

const app = express();
const port = Number(process.env.PORT || 8443);

initDb();

app.disable('x-powered-by');
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
  credentials: true,
}));
app.use(express.json({ limit: '512kb' }));
app.use(requestLogger);

app.get('/healthz', (_, res) => res.json({ ok: true, service: 'auro-policy', version: '1.0.0' }));
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/policies', policyRoutes);
app.use('/api/v1/incidents', incidentRoutes);
app.use('/api/v1/agents', agentRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/admin', overrideRoutes);

app.use(errorHandler);

app.listen(port, () => {
  console.log(`[auro-policy] listening on :${port}`);
});
