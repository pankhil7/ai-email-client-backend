import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(__dirname, '../data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'app.db'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Accounts table — stores all added email accounts
db.exec(`
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
  );
`);

// Tokens table — stores latest OAuth tokens (kept in sync with tokenStore)
db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    account_id TEXT PRIMARY KEY,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    email TEXT
  );
`);

export default db;
