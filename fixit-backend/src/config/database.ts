import pg from 'pg';
import { env } from './env.js';

// One shared pool for the whole app. The connection string stays on the
// server and is never sent to the mobile app.
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
  query_timeout: 5000,
  idleTimeoutMillis: 30000,
});

// An idle connection can drop (for example when Neon pauses the database).
// Without this listener, that error would crash the whole process.
pool.on('error', (error) => {
  console.error('Unexpected database pool error:', error.message);
});

export async function checkDatabase(): Promise<void> {
  await pool.query('SELECT 1');
}