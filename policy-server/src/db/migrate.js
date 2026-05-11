import 'dotenv/config';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, initDb } from './index.js';
import { seedDefaults } from './seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, 'migrations');

function runMigrations() {
  const db = getDb();

  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_version').all().map(r => r.version)
  );

  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const ver = parseInt(file.split('_')[0], 10);
    if (applied.has(ver)) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    const tx = db.transaction(() => {
      for (const stmt of statements) {
        try {
          db.exec(stmt);
        } catch (e) {
          if (e.message.includes('duplicate column name') || e.message.includes('already exists')) {
            continue;
          }
          throw e;
        }
      }
      db.prepare('INSERT INTO schema_version (version, name) VALUES (?, ?)').run(ver, file);
    });
    tx();
    console.log(`[migrate] applied ${file}`);
  }
}

initDb();
runMigrations();
await seedDefaults();
console.log('[migrate] done');
