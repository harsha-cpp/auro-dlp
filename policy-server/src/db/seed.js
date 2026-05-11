import 'dotenv/config';
import bcrypt from 'bcrypt';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from './index.js';
import { signPolicy } from '../services/signing.js';

export async function seedDefaults() {
  const db = getDb();

  // Default admin
  const u = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@hospital.local');
  if (!u) {
    const hash = await bcrypt.hash('changeme-on-first-login', 12);
    db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)')
      .run('admin@hospital.local', hash, 'admin');
    console.log('[seed] created admin@hospital.local / changeme-on-first-login');
  }

  // Active policy bundle (load default from agent configs if available)
  const active = db.prepare('SELECT version FROM policies WHERE active = 1').get();
  if (!active) {
    let yaml = `version: "default-1.0"
warn_threshold: 0.30
block_threshold: 0.65
hard_block_rules:
  - IN.AADHAAR
hard_block_categories: []
messages:
  WARN:  "This message contains content that looks like sensitive patient data. Send only if absolutely necessary."
  BLOCK: "This message contains protected patient information. Sending externally is blocked by hospital policy."
  HARD:  "Aadhaar / regulated identifier detected — this transmission is blocked and cannot be overridden by you."
override_allowed:
  WARN: true
  BLOCK: true
rule_weights: {}
`;
    const repoPolicy = join(process.cwd(), '..', 'endpoint-agent', 'configs', 'policy.yaml');
    if (existsSync(repoPolicy)) {
      yaml = readFileSync(repoPolicy, 'utf8');
    }
    let sig = '';
    try { sig = signPolicy(yaml); } catch (e) {
      console.warn('[seed] signing key missing; storing unsigned policy. Run `npm run gen-keys` then re-seed.');
    }
    db.prepare('INSERT INTO policies (version, yaml, signature, active) VALUES (?, ?, ?, 1)')
      .run('default-1.0', yaml, sig);
    console.log('[seed] activated default policy');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await seedDefaults();
}
