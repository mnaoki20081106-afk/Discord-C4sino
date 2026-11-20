import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DB_PATH ?? './data/casino.db';
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  discord_id TEXT PRIMARY KEY,
  balance    INTEGER NOT NULL DEFAULT 0,  -- chips
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS deposits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT NOT NULL,
  method     TEXT NOT NULL CHECK(method IN ('paypay','ltc')),
  amount_jpy INTEGER NOT NULL,            -- 円換算
  amount_raw TEXT    NOT NULL,            -- LTC satoshi 文字列 or 円
  tx_ref     TEXT,                        -- paypay link id / ltc txid
  status     TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','rejected')),
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  confirmed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(discord_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_txref ON deposits(tx_ref) WHERE tx_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS ltc_addresses (
  discord_id TEXT PRIMARY KEY,
  address    TEXT NOT NULL UNIQUE,
  derivation TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,            -- uuid
  discord_id TEXT NOT NULL,
  game       TEXT NOT NULL,                -- 'blackjack' | 'slots' | ...
  state      TEXT NOT NULL,                -- JSON
  bet        INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','done','abandoned')),
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(discord_id, status);

CREATE TABLE IF NOT EXISTS ledger (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT NOT NULL,
  delta      INTEGER NOT NULL,
  reason     TEXT NOT NULL,                -- deposit/bet/win/refund
  ref        TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(discord_id);

CREATE TABLE IF NOT EXISTS panels (
  guild_id   TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  game       TEXT NOT NULL,
  PRIMARY KEY (channel_id, game)
);
`);

export function ensureUser(discordId: string) {
  db.prepare('INSERT OR IGNORE INTO users(discord_id) VALUES (?)').run(discordId);
}

export function getBalance(discordId: string): number {
  ensureUser(discordId);
  const row = db.prepare('SELECT balance FROM users WHERE discord_id = ?').get(discordId) as { balance: number };
  return row.balance;
}

export const txCredit = db.transaction((discordId: string, delta: number, reason: string, ref?: string) => {
  ensureUser(discordId);
  const upd = db.prepare('UPDATE users SET balance = balance + ? WHERE discord_id = ? AND balance + ? >= 0').run(delta, discordId, delta);
  if (upd.changes !== 1) throw new Error('insufficient funds or user missing');
  db.prepare('INSERT INTO ledger(discord_id, delta, reason, ref) VALUES (?,?,?,?)').run(discordId, delta, reason, ref ?? null);
});
