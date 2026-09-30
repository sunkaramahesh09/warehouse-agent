import { resetEnvironment } from '../src/db/reset.js';
import { pool } from '../src/db/pool.js';

const r = await resetEnvironment();
console.log(`Environment reset to ${r.seedVersion}`);
console.table(r.counts);
await pool.end();
