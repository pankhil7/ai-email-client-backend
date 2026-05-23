import { Pool } from 'pg';
import logger from './logger';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      provider TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      imap_host TEXT,
      imap_port INTEGER,
      imap_password TEXT,
      color TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tokens (
      account_id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      email TEXT
    )
  `);

  logger.info('Database initialized');
}

export default pool;
