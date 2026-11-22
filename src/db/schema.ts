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
  balance    INTEGER NOT NULL DEFAULT 0,  -- chips (= pp_reserve + ltc_reserve 不変式)
  pp_reserve  INTEGER NOT NULL DEFAULT 0, -- PayPay 由来の裏付け
  ltc_reserve INTEGER NOT NULL DEFAULT 0, -- LTC 由来の裏付け
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

-- カジノ運営側の受取ウォレット (PayPay / LTC)
CREATE TABLE IF NOT EXISTS wallets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL CHECK(kind IN ('paypay','ltc')),
  label         TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  -- PayPay 用
  phone         TEXT,
  access_token  TEXT,
  refresh_token TEXT,
  device_uuid   TEXT,
  external_user_id TEXT,
  display_name  TEXT,
  -- LTC 用
  address       TEXT,
  derivation    TEXT,
  -- 共通
  owner_id      TEXT NOT NULL,                -- 登録した管理者
  created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  last_used_at  INTEGER,
  balance_cached INTEGER                       -- 直近の PayPay 残高キャッシュ
);
CREATE INDEX IF NOT EXISTS idx_wallets_kind ON wallets(kind, enabled);

-- ユーザー BAN
CREATE TABLE IF NOT EXISTS user_bans (
  discord_id TEXT PRIMARY KEY,
  reason     TEXT,
  banned_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- 出金記録
CREATE TABLE IF NOT EXISTS withdrawals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id   TEXT NOT NULL,
  method       TEXT NOT NULL CHECK(method IN ('paypay','ltc')),
  amount_jpy   INTEGER NOT NULL,            -- ユーザーに返す金額 (手数料控除前)
  fee_jpy      INTEGER NOT NULL DEFAULT 0,  -- LTC は手数料を控除
  net_jpy      INTEGER NOT NULL,            -- 実際に届く金額
  dest         TEXT,                         -- LTC アドレス or null
  passcode     TEXT,                         -- PayPay パスコード
  link_url     TEXT,                         -- PayPay 送金リンク
  tx_ref       TEXT,                         -- order_id or LTC txid
  wallet_id    INTEGER,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed','cancelled')),
  reason       TEXT,
  created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user   ON withdrawals(discord_id, status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);

-- 実績 (当選記録)
CREATE TABLE IF NOT EXISTS achievements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  game       TEXT NOT NULL,
  bet        INTEGER NOT NULL,
  payout     INTEGER NOT NULL,
  net        INTEGER NOT NULL,
  mult       REAL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_ach_guild ON achievements(guild_id);
`);

// Migration: 既存ユーザーに pp_reserve / ltc_reserve が無ければ追加し、
// 既存 balance を全額 pp_reserve に寄せる (保守的 — LTC 出金は実際の LTC 入金分に限定)
for (const col of ['pp_reserve INTEGER NOT NULL DEFAULT 0', 'ltc_reserve INTEGER NOT NULL DEFAULT 0']) {
  try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch { /* exists */ }
}
db.exec(`UPDATE users SET pp_reserve = balance WHERE pp_reserve + ltc_reserve = 0 AND balance > 0`);

export function ensureUser(discordId: string) {
  db.prepare('INSERT OR IGNORE INTO users(discord_id) VALUES (?)').run(discordId);
}

export interface Reserves { pp: number; ltc: number; total: number }

export function getReserves(discordId: string): Reserves {
  ensureUser(discordId);
  const r = db.prepare('SELECT balance, pp_reserve, ltc_reserve FROM users WHERE discord_id=?').get(discordId) as
    { balance: number; pp_reserve: number; ltc_reserve: number };
  return { pp: r.pp_reserve, ltc: r.ltc_reserve, total: r.balance };
}

/** 指定レールに加算 (入金、WIN の rail 固定クレジット、refund で使用) */
export const creditRail = db.transaction((discordId: string, rail: 'pp'|'ltc', amount: number, reason: string, ref?: string) => {
  if (amount <= 0) throw new Error('amount must be positive');
  ensureUser(discordId);
  const col = rail === 'pp' ? 'pp_reserve' : 'ltc_reserve';
  db.prepare(`UPDATE users SET balance = balance + ?, ${col} = ${col} + ? WHERE discord_id = ?`).run(amount, amount, discordId);
  db.prepare('INSERT INTO ledger(discord_id, delta, reason, ref) VALUES (?,?,?,?)').run(discordId, amount, reason, ref ?? null);
});

/** 指定レールから減算 (出金用、残高はそのレールぶんまで) */
export const debitRail = db.transaction((discordId: string, rail: 'pp'|'ltc', amount: number, reason: string, ref?: string) => {
  if (amount <= 0) throw new Error('amount must be positive');
  ensureUser(discordId);
  const col = rail === 'pp' ? 'pp_reserve' : 'ltc_reserve';
  const upd = db.prepare(`UPDATE users SET balance = balance - ?, ${col} = ${col} - ? WHERE discord_id = ? AND ${col} >= ?`)
    .run(amount, amount, discordId, amount);
  if (upd.changes !== 1) throw new Error(`${rail} reserve insufficient`);
  db.prepare('INSERT INTO ledger(discord_id, delta, reason, ref) VALUES (?,?,?,?)').run(discordId, -amount, reason, ref ?? null);
});

/** 指定の (pp, ltc) 内訳で加減 — 将来ユーザー BET 選択 UI 用 */
export const applyMix = db.transaction((discordId: string, ppDelta: number, ltcDelta: number, reason: string, ref?: string) => {
  ensureUser(discordId);
  const delta = ppDelta + ltcDelta;
  const upd = db.prepare(`UPDATE users SET balance = balance + ?, pp_reserve = pp_reserve + ?, ltc_reserve = ltc_reserve + ?
    WHERE discord_id = ? AND pp_reserve + ? >= 0 AND ltc_reserve + ? >= 0`)
    .run(delta, ppDelta, ltcDelta, discordId, ppDelta, ltcDelta);
  if (upd.changes !== 1) throw new Error('mix apply failed (insufficient in some rail)');
  db.prepare('INSERT INTO ledger(discord_id, delta, reason, ref) VALUES (?,?,?,?)').run(discordId, delta, reason, ref ?? null);
});

/** 比率を保ったまま debit (reserves の比率で按分)。整数端数は pp 側に寄せる。 */
function splitProportional(pp: number, ltc: number, amount: number): { pp: number; ltc: number } {
  const total = pp + ltc;
  if (total <= 0) return { pp: 0, ltc: 0 };
  const ltcPart = Math.min(ltc, Math.floor(amount * ltc / total));
  const ppPart = amount - ltcPart;
  return { pp: Math.min(pp, ppPart), ltc: ltcPart };
}

export function getBalance(discordId: string): number {
  ensureUser(discordId);
  const row = db.prepare('SELECT balance FROM users WHERE discord_id = ?').get(discordId) as { balance: number };
  return row.balance;
}

/**
 * 既存 API 互換のクレジット/デビット。レール追跡を内部で行う:
 *  - delta < 0 (BET など): 現在の pp:ltc 比率で按分して各 reserve を減らす
 *  - delta > 0 (WIN, admin 加算): 現在の比率で按分して各 reserve を増やす。
 *    reserve の total が 0 の場合は PP に寄せる (保守的 — LTC 枯渇防止)
 * 不変式: balance == pp_reserve + ltc_reserve を常に維持
 */
export const txCredit = db.transaction((discordId: string, delta: number, reason: string, ref?: string) => {
  ensureUser(discordId);
  const row = db.prepare('SELECT balance, pp_reserve, ltc_reserve FROM users WHERE discord_id=?').get(discordId) as
    { balance: number; pp_reserve: number; ltc_reserve: number };

  let ppDelta: number, ltcDelta: number;
  if (delta < 0) {
    if (row.balance + delta < 0) throw new Error('insufficient funds');
    const take = splitProportional(row.pp_reserve, row.ltc_reserve, -delta);
    ppDelta = -take.pp; ltcDelta = -take.ltc;
    // 端数で差が出ないよう再調整
    const remaining = -delta - (take.pp + take.ltc);
    if (remaining > 0) {
      if (row.pp_reserve + ppDelta >= remaining) ppDelta -= remaining;
      else ltcDelta -= remaining;
    }
  } else if (delta > 0) {
    const total = row.pp_reserve + row.ltc_reserve;
    if (total <= 0) { ppDelta = delta; ltcDelta = 0; }
    else {
      const ltcPart = Math.floor(delta * row.ltc_reserve / total);
      ltcDelta = ltcPart;
      ppDelta = delta - ltcPart;
    }
  } else {
    return; // delta == 0
  }

  const upd = db.prepare(`UPDATE users SET balance = balance + ?, pp_reserve = pp_reserve + ?, ltc_reserve = ltc_reserve + ?
    WHERE discord_id = ? AND pp_reserve + ? >= 0 AND ltc_reserve + ? >= 0`)
    .run(delta, ppDelta, ltcDelta, discordId, ppDelta, ltcDelta);
  if (upd.changes !== 1) throw new Error('insufficient funds or user missing');
  db.prepare('INSERT INTO ledger(discord_id, delta, reason, ref) VALUES (?,?,?,?)').run(discordId, delta, reason, ref ?? null);
});

export function isBanned(discordId: string): boolean {
  const r = db.prepare('SELECT 1 FROM user_bans WHERE discord_id = ?').get(discordId);
  return !!r;
}

export function assertNotBanned(discordId: string) {
  if (isBanned(discordId)) throw new Error('あなたはこのカジノの利用を停止されています');
}
