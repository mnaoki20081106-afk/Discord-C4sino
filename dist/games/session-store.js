import { randomUUID } from 'node:crypto';
import { db } from '../db/schema.js';
// mix 列を sessions テーブルに追加 (既存 DB の in-place migration)
try {
    db.exec(`ALTER TABLE sessions ADD COLUMN mix TEXT`);
}
catch { /* exists */ }
const map = new Map();
/** DB に write-through して永続化 */
function persist(e) {
    db.prepare(`INSERT OR REPLACE INTO sessions(id, discord_id, game, state, bet, status, mix, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, strftime('%s','now'))`)
        // テストプレイは chip を引き落としていないので、再起動時の返金対象にならないよう bet=0 で保存する
        .run(e.id, e.discordId, e.game, JSON.stringify(e.state), e.test ? 0 : e.bet, e.mix ? JSON.stringify(e.mix) : null);
}
export function create(discordId, game, state, bet, mix, test = false) {
    const id = randomUUID();
    const e = { id, discordId, game, state, bet, mix, test };
    map.set(id, e);
    persist(e);
    return e;
}
export const get = (id) => map.get(id);
/** セッション状態を更新したあとに呼ぶ (mutation 後の write-through)。 */
export function save(id) {
    const e = map.get(id);
    if (e)
        persist(e);
}
export function drop(id) {
    map.delete(id);
    db.prepare('DELETE FROM sessions WHERE id=?').run(id);
}
export function listByUser(discordId) {
    const out = [];
    for (const e of map.values())
        if (e.discordId === discordId)
            out.push(e);
    return out;
}
/**
 * 起動時: active のまま残っているセッションは再開不可として abandoned に遷移 + BET を refund する。
 * BJ/VP/Craps/Mines の進行中の chip が再起動で消えないことを保証する。
 * 返金は BET したときの PayPay / LTC の内訳 (sessions.mix) のまま戻す。内訳が無い古い行だけ従来どおり。
 * refundBet は index.ts 側から渡す (dep cycle 回避)。
 */
export function recoverActiveSessions(refundBet) {
    const rows = db.prepare(`SELECT id, discord_id, game, bet, mix FROM sessions WHERE status='active'`).all();
    if (!rows.length)
        return;
    for (const r of rows) {
        try {
            let mix;
            try {
                const j = r.mix ? JSON.parse(r.mix) : null;
                if (j && Number.isSafeInteger(j.pp) && Number.isSafeInteger(j.ltc) && j.pp >= 0 && j.ltc >= 0 && j.pp + j.ltc > 0)
                    mix = { pp: j.pp, ltc: j.ltc };
            }
            catch { /* 壊れた mix は無いものとして bet 額で返す */ }
            const amount = mix ? mix.pp + mix.ltc : r.bet;
            if (r.bet > 0 && amount > 0)
                refundBet(r.discord_id, amount, `refund:session-abandoned:${r.game}`, r.id, mix);
            db.prepare(`UPDATE sessions SET status='abandoned', updated_at=strftime('%s','now') WHERE id=?`).run(r.id);
            console.log(`[sessions] recovered: abandoned+refunded ${r.id} (${r.game}, user=${r.discord_id}, amount=${amount})`);
        }
        catch (e) {
            console.error(`[sessions] recover failed for ${r.id}:`, e.message);
        }
    }
}
