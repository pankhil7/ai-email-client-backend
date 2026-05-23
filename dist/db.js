"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const DATA_DIR = path_1.default.join(__dirname, '../data');
fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
const db = new better_sqlite3_1.default(path_1.default.join(DATA_DIR, 'app.db'));
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
exports.default = db;
