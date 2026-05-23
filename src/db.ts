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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      token TEXT PRIMARY KEY,
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_labels (
      email_id TEXT NOT NULL,
      label TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (email_id, label)
    )
  `);

  // Migrations: add user_id columns if they don't exist yet
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE email_labels ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT ''`);

  // Back-fill accounts.user_id from email column (OAuth account owner = their email)
  await pool.query(`UPDATE accounts SET user_id = email WHERE user_id = ''`);

  logger.info('Database initialized');
}

export default pool;
