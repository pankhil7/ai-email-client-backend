"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDb = initDb;
const pg_1 = require("pg");
const logger_1 = __importDefault(require("./logger"));
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});
async function initDb() {
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
      PRIMARY KEY (email_id, label)
    )
  `);
    logger_1.default.info('Database initialized');
}
exports.default = pool;
