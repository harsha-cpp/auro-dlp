import 'dotenv/config';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from './index.js';
import { signPolicy } from '../services/signing.js';

export async function seedDefaults() {
  const db = getDb();

  const u = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@hospital.local');
  if (!u) {
    const password = crypto.randomBytes(12).toString('base64url').slice(0, 16);
    const hash = await bcrypt.hash(password, 12);
    try {
      db.prepare('INSERT INTO users (email, password_hash, role, must_change_password) VALUES (?, ?, ?, 1)')
        .run('admin@hospital.local', hash, 'admin');
    } catch {
      db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)')
        .run('admin@hospital.local', hash, 'admin');
    }
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  ADMIN CREDENTIALS (shown only once — save securely!)       ║');
    console.log(`║  Email:    admin@hospital.local                              ║`);
    console.log(`║  Password: ${password}                              ║`);
    console.log('║  You MUST change this password on first login.              ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');

    const credsPath = join(process.cwd(), 'SEEDED_CREDENTIALS.txt');
    const credsContent = `AURO-DLP SEED CREDENTIALS — change immediately after first login.

URL:      http://localhost:5173
Email:    admin@hospital.local
Password: ${password}
Generated: ${new Date().toISOString()}
`;
    writeFileSync(credsPath, credsContent, 'utf8');
    console.log(`[seed] credentials written to ${credsPath}`);
  }

  const active = db.prepare('SELECT version FROM policies WHERE active = 1').get();
  if (!active) {
    let yaml = `version: "default-1.0"\nwarn_threshold: 0.30\nblock_threshold: 0.65\nhard_block_rules:\n  - IN.AADHAAR\nhard_block_categories: []\nmessages:\n  WARN:  "This message contains content that looks like sensitive patient data."\n  BLOCK: "This message contains protected patient information. Sending externally is blocked."\n  HARD:  "Aadhaar / regulated identifier detected — blocked."\noverride_allowed:\n  WARN: true\n  BLOCK: true\nrule_weights: {}\n`;
    const repoPolicy = join(process.cwd(), '..', 'endpoint-agent', 'configs', 'policy.yaml');
    if (existsSync(repoPolicy)) {
      yaml = readFileSync(repoPolicy, 'utf8');
    }
    let sig = '';
    try { sig = signPolicy(yaml); } catch { /* no key yet */ }
    db.prepare('INSERT INTO policies (version, yaml, signature, active) VALUES (?, ?, ?, 1)')
      .run('default-1.0', yaml, sig);
    console.log('[seed] activated default policy');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await seedDefaults();
}
