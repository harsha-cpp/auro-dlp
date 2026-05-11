import 'dotenv/config';
import { initDb } from './index.js';
import { seedDefaults } from './seed.js';

initDb();
await seedDefaults();
console.log('[migrate] schema ready');
