import pg from 'pg';
import { config } from '../config.js';

// Return timestamps as ISO strings and NUMERIC as numbers so tool outputs are plain JSON.
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString()); // timestamptz
pg.types.setTypeParser(1700, (v) => parseFloat(v)); // numeric
pg.types.setTypeParser(20, (v) => parseInt(v, 10)); // int8 (bigserial seq)

const ssl = /sslmode=require|supabase|railway\.app|rlwy\.net/.test(config.databaseUrl) && !/sslmode=disable/.test(config.databaseUrl)
  ? { rejectUnauthorized: false }
  : undefined;

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, ssl });

export type Db = pg.Pool | pg.PoolClient;

export async function withTx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function one<T = any>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await db.query(sql, params);
  return (r.rows[0] as T) ?? null;
}

export async function many<T = any>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await db.query(sql, params);
  return r.rows as T[];
}
