/**
 * MWS (cloud.m-ws.cc) 7 日自動延長タイマーの状態管理。
 *
 * MWS 側に自動延長 API は叩かない (規約違反のため)。user がダッシュボードで
 * 手動で「延長」ボタンを押したタイミングで /mws 延長完了 or パネルのボタンから
 * markExtended() を呼び、こちら側のタイマーをリセットする。
 *
 * tick() を一定間隔で呼ぶと、残り時間が 24h / 6h / 1h の閾値を跨いだ時に
 * 通知チャンネル (notify_channel_id) に警告メッセージを 1 回だけ送信する。
 */
import { db } from '../db/schema.js';

export const EXTENSION_PERIOD_SEC = 7 * 24 * 60 * 60; // 7 日

/** 発火対象の閾値 (時間). 大きい順に並べる. */
const WARN_BUCKETS = [24, 6, 1] as const;
type Bucket = (typeof WARN_BUCKETS)[number];

export interface MwsState {
  lastExtendedAt: number;      // unix sec
  notifyChannelId: string | null;
  notifyRoleId: string | null;
  lastWarnBucket: number;      // 0 / 24 / 6 / 1 / -1 (expired)
  remainingSec: number;        // 残り秒 (負なら期限切れ)
  expiresAt: number;           // unix sec
}

function ensureRow(): void {
  db.prepare(
    `INSERT OR IGNORE INTO mws_extension(id, last_extended_at) VALUES (1, strftime('%s','now'))`
  ).run();
}

/** 現在のタイマー状態を取得。初回呼び出しで行を生成する。 */
export function getState(now: number = Math.floor(Date.now() / 1000)): MwsState {
  ensureRow();
  const row = db.prepare(
    `SELECT last_extended_at, notify_channel_id, notify_role_id, last_warn_bucket
       FROM mws_extension WHERE id = 1`
  ).get() as {
    last_extended_at: number;
    notify_channel_id: string | null;
    notify_role_id: string | null;
    last_warn_bucket: number;
  };
  const expiresAt = row.last_extended_at + EXTENSION_PERIOD_SEC;
  return {
    lastExtendedAt: row.last_extended_at,
    notifyChannelId: row.notify_channel_id,
    notifyRoleId: row.notify_role_id,
    lastWarnBucket: row.last_warn_bucket,
    remainingSec: expiresAt - now,
    expiresAt,
  };
}

/** タイマーをリセット (user が MWS 側で延長ボタンを押した後に呼ぶ). */
export function markExtended(now: number = Math.floor(Date.now() / 1000)): MwsState {
  ensureRow();
  db.prepare(
    `UPDATE mws_extension SET last_extended_at = ?, last_warn_bucket = 0 WHERE id = 1`
  ).run(now);
  return getState(now);
}

/** 通知チャンネル (および任意で mention するロール) を設定。 */
export function setNotifyTarget(channelId: string, roleId?: string | null): MwsState {
  ensureRow();
  db.prepare(
    `UPDATE mws_extension SET notify_channel_id = ?, notify_role_id = ? WHERE id = 1`
  ).run(channelId, roleId ?? null);
  return getState();
}

/** 通知設定を解除。 */
export function clearNotifyTarget(): MwsState {
  ensureRow();
  db.prepare(
    `UPDATE mws_extension SET notify_channel_id = NULL, notify_role_id = NULL WHERE id = 1`
  ).run();
  return getState();
}

/**
 * tick: 残り時間を確認し、閾値跨ぎがあれば通知する。
 * 通知を送った場合はその内容を返す。送らなかった場合は null。
 * last_warn_bucket は「最後に発火した閾値」を記録しており、
 * 同じ閾値では二重に発火しない。
 */
export function evaluateTick(now: number = Math.floor(Date.now() / 1000)): {
  bucket: Bucket | 'expired';
  state: MwsState;
} | null {
  const state = getState(now);
  if (state.remainingSec <= 0) {
    // 期限切れ: last_warn_bucket が -1 でなければ 1 回だけ通知
    if (state.lastWarnBucket !== -1) {
      db.prepare(`UPDATE mws_extension SET last_warn_bucket = -1 WHERE id = 1`).run();
      return { bucket: 'expired', state: { ...state, lastWarnBucket: -1 } };
    }
    return null;
  }
  const hoursLeft = state.remainingSec / 3600;
  // 残り時間が bucket を下回った最大 bucket (24 → 6 → 1) を探す
  // 「bucket 以下」にいる = その警告を発火する
  // last_warn_bucket は現状発火済みの bucket (大きい数が「まだ早い段階」):
  //   24 発火済 → lastWarnBucket=24, 次は hoursLeft<=6 で bucket=6
  const fireable = WARN_BUCKETS.find(b => hoursLeft <= b && (state.lastWarnBucket === 0 || b < state.lastWarnBucket));
  if (fireable) {
    db.prepare(`UPDATE mws_extension SET last_warn_bucket = ? WHERE id = 1`).run(fireable);
    return { bucket: fireable, state: { ...state, lastWarnBucket: fireable } };
  }
  return null;
}

/** "残り 2d 15h 30m" 形式の文字列を返す。 */
export function formatRemaining(remainingSec: number): string {
  if (remainingSec <= 0) return '**期限切れ**';
  const d = Math.floor(remainingSec / 86400);
  const h = Math.floor((remainingSec % 86400) / 3600);
  const m = Math.floor((remainingSec % 3600) / 60);
  if (d > 0) return `残り **${d}d ${h}h ${m}m**`;
  if (h > 0) return `残り **${h}h ${m}m**`;
  return `残り **${m}m**`;
}

/** 0..1 の進捗割合 (経過分 / 全期間) を返す。1 に近いほど残り僅か。 */
export function elapsedRatio(state: MwsState, now: number = Math.floor(Date.now() / 1000)): number {
  const elapsed = now - state.lastExtendedAt;
  return Math.max(0, Math.min(1, elapsed / EXTENSION_PERIOD_SEC));
}
