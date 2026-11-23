import { randomUUID } from 'node:crypto';
import type { BJState } from './blackjack.js';
import type { VPHand }  from './videopoker.js';
import type { CrapsState } from './craps.js';
import { db } from '../db/schema.js';

type AnyState = BJState | VPHand | CrapsState | { kind: 'slots'; bet: number };

export interface BetMix { pp: number; ltc: number }
interface Entry { id: string; discordId: string; game: 'blackjack'|'slots'|'videopoker'|'craps'; state: AnyState; bet: number; mix?: BetMix; test?: boolean; }

// mix 列を sessions テーブルに追加 (既存 DB の in-place migration)
try { db.exec(`ALTER TABLE sessions ADD COLUMN mix TEXT`); } catch { /* exists */ }

const map = new Map<string, Entry>();

/** DB に write-through して永続化 */
function persist(e: Entry) {
  db.prepare(`INSERT OR REPLACE INTO sessions(id, discord_id, game, state, bet, status, mix, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, strftime('%s','now'))`)
    // テストプレイは chip を引き落としていないので、再起動時の返金対象にならないよう bet=0 で保存する
    .run(e.id, e.discordId, e.game, JSON.stringify(e.state), e.test ? 0 : e.bet, e.mix ? JSON.stringify(e.mix) : null);
}

export function create(discordId: string, game: Entry['game'], state: AnyState, bet: number, mix?: BetMix, test = false): Entry {
  const id = randomUUID();
  const e: Entry = { id, discordId, game, state, bet, mix, test };
  map.set(id, e);
  persist(e);
  return e;
}

export const get = (id: string) => map.get(id);

/** セッション状態を更新したあとに呼ぶ (mutation 後の write-through)。 */
export function save(id: string) {
  const e = map.get(id);
  if (e) persist(e);
}

export function drop(id: string) {
  map.delete(id);
  db.prepare('DELETE FROM sessions WHERE id=?').run(id);
}

export function listByUser(discordId: string): Entry[] {
  const out: Entry[] = [];
  for (const e of map.values()) if (e.discordId === discordId) out.push(e);
  return out;
}

/**
 * 起動時: active のまま残っているセッションは再開不可として abandoned に遷移 + BET を refund する。
 * BJ/VP/Craps の進行中の chip が再起動で消えないことを保証する。
 * refundBet は index.ts 側から渡す (dep cycle 回避)。
 */
export function recoverActiveSessions(refundBet: (discordId: string, amount: number, reason: string, ref: string) => void) {
  const rows = db.prepare(`SELECT id, discord_id, game, bet FROM sessions WHERE status='active'`).all() as Array<{
    id: string; discord_id: string; game: string; bet: number;
  }>;
  if (!rows.length) return;
  for (const r of rows) {
    try {
      if (r.bet > 0) refundBet(r.discord_id, r.bet, `refund:session-abandoned:${r.game}`, r.id);
      db.prepare(`UPDATE sessions SET status='abandoned', updated_at=strftime('%s','now') WHERE id=?`).run(r.id);
      console.log(`[sessions] recovered: abandoned+refunded ${r.id} (${r.game}, user=${r.discord_id}, bet=${r.bet})`);
    } catch (e) {
      console.error(`[sessions] recover failed for ${r.id}:`, (e as Error).message);
    }
  }
}
