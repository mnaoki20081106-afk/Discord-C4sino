/**
 * LTC 入金の照合。運営の LTC アドレス 1 つで受け取る。
 *
 * 入金の申請ごとに、送る量の末尾に端数 (1〜999 litoshi) を足して、ほかの申請と重ならない量にする。
 *   例: ¥5,000 → 0.03412 LTC → 0.03412123 LTC
 * 運営アドレスに届いた送金の量がこれとぴったり同じなら、その申請の人の入金とみなす。
 */
import { db } from '../db/schema.js';

export const REQUEST_TTL_SEC = 60 * 60;      // 申請の期限 (この時間内に届いた送金だけ照合する)
const ROUND_SAT = 1000;                      // 本体は 0.00001 LTC 単位に丸め、下 3 桁を端数に使う

export interface DepositRequest {
  id: number; discord_id: string; address: string; amount_sat: number; jpy: number;
  created_at: number; expires_at: number; status: string; txid: string | null;
}

export const satToLtc = (sat: number) => (sat / 1e8).toFixed(8);

/** 申請を作る。同じ人の未完了の申請は置き換える。 */
export function createRequest(discordId: string, address: string, jpy: number, rate: number, now = Math.floor(Date.now() / 1000)): DepositRequest {
  const base = Math.max(ROUND_SAT, Math.round((jpy / rate) * 1e8 / ROUND_SAT) * ROUND_SAT);
  return db.transaction(() => {
    db.prepare(`UPDATE ltc_deposit_requests SET status='replaced' WHERE discord_id=? AND status='pending'`).run(discordId);
    // 期限内に届く可能性がある申請と、端数が重ならないようにする
    const used = new Set((db.prepare(
      `SELECT amount_sat FROM ltc_deposit_requests WHERE address=? AND status='pending' AND expires_at > ?`
    ).all(address, now - REQUEST_TTL_SEC) as { amount_sat: number }[]).map(r => r.amount_sat));
    const free: number[] = [];
    for (let off = 1; off < ROUND_SAT; off++) if (!used.has(base + off)) free.push(base + off);
    if (!free.length) throw new Error('入金の申請が混み合っています。少し待ってからやり直してください');
    const amount = free[Math.floor(Math.random() * free.length)];
    const id = db.prepare(
      `INSERT INTO ltc_deposit_requests(discord_id, address, amount_sat, jpy, created_at, expires_at) VALUES (?,?,?,?,?,?)`
    ).run(discordId, address, amount, jpy, now, now + REQUEST_TTL_SEC).lastInsertRowid as number;
    return db.prepare('SELECT * FROM ltc_deposit_requests WHERE id=?').get(id) as DepositRequest;
  })();
}

/** 届いた送金に合う申請 (量がぴったり同じで、申請してから期限までに届いたもの) */
export function findRequest(address: string, valueSat: number, receivedAt: number): DepositRequest | null {
  return (db.prepare(
    `SELECT * FROM ltc_deposit_requests
      WHERE address=? AND amount_sat=? AND status='pending' AND created_at <= ? AND expires_at >= ?
      ORDER BY id LIMIT 1`
  ).get(address, valueSat, receivedAt + 120, receivedAt) as DepositRequest | undefined) ?? null;
}

/** 最初の申請の時刻。これより前に届いた送金は照合の対象外 (登録前からの送金を通知しないため)。 */
export function firstRequestAt(address: string): number | null {
  const r = db.prepare('SELECT MIN(created_at) AS t FROM ltc_deposit_requests WHERE address=?').get(address) as { t: number | null };
  return r.t;
}

export function markCredited(id: number, txid: string) {
  db.prepare(`UPDATE ltc_deposit_requests SET status='credited', txid=? WHERE id=?`).run(txid, id);
}
