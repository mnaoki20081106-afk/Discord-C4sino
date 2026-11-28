/**
 * カジノ運営の流動性 (JPY 換算) を計算し、ベット上限を決める。
 * 当選最大額がこの流動性を上回る場合、そのベットは受付しない。
 */
import * as wallets from './wallets.js';
import * as pp from './paypay-client.js';
import { addressBalanceLtc, ltcJpyRate } from './ltc.js';
import { db } from '../db/schema.js';

/** 各ゲームで 1 bet あたりに発生しうる最大 "gross payout" の倍率。 */
export type GameMultKey = 'blackjack'|'slots'|'roulette'|'baccarat'|'videopoker'|'craps';

export const MAX_GROSS_MULT: Record<GameMultKey, number> = {
  blackjack: 16,     // 4 hands × double × win
  slots:     2300,   // 7️⃣×3
  roulette:  36,     // straight-up
  baccarat:  9,      // Tie
  videopoker: 800,   // Royal Flush
  craps:     31,     // 30:1 snake-eyes / boxcars (最大)
};

/**
 * クラップスとマインスイーパー: 進行中のセッションが払う可能性のある額を session ID ごとに持ち、
 * 他の人の上限計算から差し引く (同時に遊ばれても合計で運営の残高を超えないため)。
 * Craps 専用だった名前のまま、マインスイーパーも同じ表を使う。
 * 以下は元の説明: アクティブなセッションの未決済最大 gross 合計を管理し、
 * 合算で流動性を超えないよう検査する。
 */
const crapsExposures = new Map<string, number>();
export function setCrapsExposure(sessionId: string, maxGross: number) {
  crapsExposures.set(sessionId, maxGross);
}
export function clearCrapsExposure(sessionId: string) {
  crapsExposures.delete(sessionId);
}
function totalCrapsExposure(exceptSessionId?: string): number {
  let s = 0;
  for (const [id, v] of crapsExposures) if (id !== exceptSessionId) s += v;
  return s;
}

/**
 * 同期で "今の運営の残高の合計 (JPY 換算)" を返す。外部 API に触らず、`balance_cached` と DB だけを読む。
 * BET の判定 → 結果決定 → 予約 のあいだに await を挟まないために使う (JS single-thread で atomic になる)。
 */
export function totalLiquidityJpySync(): { paypay: number; ltc: number; total: number } {
  let paypay = 0, ltc = 0;
  for (const w of wallets.listWallets()) {
    if (!w.enabled) continue;
    const jpy = Math.max(0, w.balance_cached ?? 0);
    if (w.kind === 'paypay') paypay += jpy;
    else if (w.kind === 'ltc' && w.address) ltc += jpy;
  }
  return { paypay, ltc, total: paypay + ltc };
}

/** `housePayoutCap` の同期版。BET を受けた瞬間に atomic で呼ぶためのもの。 */
export function housePayoutCapSync(exceptSessionId?: string): number {
  const liq = totalLiquidityJpySync();
  const outstanding = (db.prepare('SELECT COALESCE(SUM(balance),0) s FROM users').get() as any).s as number;
  return Math.max(0, liq.total - outstanding - totalCrapsExposure(exceptSessionId));
}

/** `clampPayout` の同期版。 */
export function clampPayoutSync(amount: number, exceptSessionId?: string): number {
  if (amount <= 0) return 0;
  return Math.min(amount, housePayoutCapSync(exceptSessionId));
}

/**
 * 全ウォレットの流動性 (JPY)。ローカル `balance_cached` を唯一の真実とする。
 * 外部システム (PayPay API / BlockCypher) の反映遅延に依らず、入出金の都度 adjustCached で
 * 更新されているローカル帳簿を参照する。opts.refresh=true の時だけ外部と同期する。
 */
export async function totalLiquidityJpy(opts?: { refresh?: boolean }): Promise<{
  total: number;
  paypay: number;
  ltc: number;
  details: Array<{ id: number; kind: string; label: string; jpy: number }>;
}> {
  const ws = wallets.listWallets().filter(w => w.enabled);
  const details: Array<{ id: number; kind: string; label: string; jpy: number }> = [];
  let paypayTotal = 0;
  let ltcTotal = 0;
  const ltcRate = await ltcJpyRate().catch(() => null);

  for (const w of ws) {
    if (w.kind === 'paypay') {
      if (opts?.refresh && w.access_token) {
        try {
          const b = await wallets.withPaypay(w, t => pp.walletBalance(t));
          wallets.setCached(w.id, b.usable_balance);
        } catch (e) {
          console.warn(`[liquidity] paypay #${w.id}:`, (e as Error).message);
        }
      }
      // refresh 済みなら再読込、それ以外は手元の cache をそのまま使う
      const jpy = (wallets.getWallet(w.id)?.balance_cached) ?? 0;
      paypayTotal += jpy;
      details.push({ id: w.id, kind: 'paypay', label: w.label, jpy });
    } else if (w.kind === 'ltc' && w.address && ltcRate) {
      if (opts?.refresh) {
        try {
          const ltc = await addressBalanceLtc(w.address);
          wallets.setCached(w.id, Math.floor(ltc * ltcRate));
        } catch (e) {
          console.warn(`[liquidity] ltc #${w.id}:`, (e as Error).message);
        }
      }
      const jpy = (wallets.getWallet(w.id)?.balance_cached) ?? 0;
      ltcTotal += jpy;
      details.push({ id: w.id, kind: 'ltc', label: w.label, jpy });
    }
  }

  return { total: paypayTotal + ltcTotal, paypay: paypayTotal, ltc: ltcTotal, details };
}

/**
 * 運営利益引き出し前の solvency 検査。今の cache + 希望引き出し額を引いても
 * 流通チップ総額を下回らないことを保証する。
 * @returns 引き出し可能なら null、不可なら理由文字列
 */
export async function assertOperatorWithdrawSafe(amountJpy: number, kind: 'paypay'|'ltc'): Promise<string | null> {
  const liq = await cachedLiquidity();
  const outstanding = (db.prepare('SELECT COALESCE(SUM(balance),0) s FROM users').get() as any).s as number;
  // 進行中のゲーム (マインスイーパー・クラップス) が払う可能性のある額も、引き出せる額から除く
  const reserved = totalCrapsExposure();
  const effectiveAfter = liq.total - outstanding - reserved - amountJpy;
  if (effectiveAfter < 0) {
    const max = Math.max(0, liq.total - outstanding - reserved);
    return `今引き出せるのは ¥${max.toLocaleString()} までです ` +
      `(運営の残高 ¥${liq.total.toLocaleString()} − ユーザーの残高 ¥${outstanding.toLocaleString()} − 進行中のゲームで確保 ¥${reserved.toLocaleString()})`;
  }
  // kind 別の個別チェックも: LTC だけ引き出して LTC 由来のチップが残らないようにする
  const reservesByRail = db.prepare(
    kind === 'paypay'
      ? 'SELECT COALESCE(SUM(pp_reserve),0) s FROM users'
      : 'SELECT COALESCE(SUM(ltc_reserve),0) s FROM users'
  ).get() as { s: number };
  const walletRailJpy = kind === 'paypay' ? liq.paypay : liq.ltc;
  if (walletRailJpy - amountJpy < reservesByRail.s) {
    const deficit = reservesByRail.s - (walletRailJpy - amountJpy);
    return `${kind.toUpperCase()} 側で ¥${deficit.toLocaleString()} 分不足します ` +
      `(${kind.toUpperCase()} 残高 ¥${walletRailJpy.toLocaleString()} − 引き出し ¥${amountJpy.toLocaleString()} < ${kind.toUpperCase()} 由来チップ ¥${reservesByRail.s.toLocaleString()})`;
  }
  return null;
}

/** 流動性キャッシュ (30秒) — 高頻度ベット時に外部APIを叩きすぎない。 */
let _cache: { at: number; liq: Awaited<ReturnType<typeof totalLiquidityJpy>> } | null = null;
const CACHE_MS = 30_000;

export async function cachedLiquidity(): Promise<Awaited<ReturnType<typeof totalLiquidityJpy>>> {
  if (_cache && Date.now() - _cache.at < CACHE_MS) return _cache.liq;
  const liq = await totalLiquidityJpy();
  _cache = { at: Date.now(), liq };
  return liq;
}

export function invalidateLiquidityCache() { _cache = null; }

/** 運営が今引き出せる利益 (円)。運営の残高 − ユーザーの残高 − 進行中のゲームで確保した額。 */
export async function operatorWithdrawable(): Promise<{ max: number; total: number; outstanding: number; reserved: number }> {
  const liq = await cachedLiquidity();
  const outstanding = (db.prepare('SELECT COALESCE(SUM(balance),0) s FROM users').get() as any).s as number;
  const reserved = totalCrapsExposure();
  return { max: Math.max(0, liq.total - outstanding - reserved), total: liq.total, outstanding, reserved };
}

/** ベット額 × 最大倍率 ≤ 流動性 を満たすか検査。失敗時は投げる。 */
/**
 * 「ハウスが今この瞬間に払える gross 上限」。bet は既に台に乗っている想定で、
 * 実際に wallet から流出するのは payout - その bet 分だが、安全側に effective 全体を返す。
 */
export async function housePayoutCap(exceptCrapsSession?: string): Promise<number> {
  const liq = await cachedLiquidity();
  const outstanding = (db.prepare('SELECT COALESCE(SUM(balance),0) s FROM users').get() as any).s as number;
  const otherCraps = totalCrapsExposure(exceptCrapsSession);
  return Math.max(0, liq.total - outstanding - otherCraps);
}

/**
 * 最終防衛線: 実際に chip 加算する直前に呼ぶ。
 * 現在の housePayoutCap を越えないよう amount をクランプして返す。
 */
export async function clampPayout(amount: number, exceptCrapsSession?: string): Promise<number> {
  if (amount <= 0) return 0;
  const cap = await housePayoutCap(exceptCrapsSession);
  return Math.min(amount, cap);
}

/** 現在の最大許容 BET をゲーム別に返す (UI 表示用)。 */
export async function maxAffordableBet(): Promise<Record<GameMultKey, number> & { liq: Awaited<ReturnType<typeof totalLiquidityJpy>>; outstanding: number; effective: number }> {
  const liq = await cachedLiquidity();
  const outstanding = (db.prepare('SELECT COALESCE(SUM(balance),0) s FROM users').get() as any).s as number;
  const effective = Math.max(0, liq.total - outstanding);
  return {
    blackjack: Math.floor(effective / MAX_GROSS_MULT.blackjack),
    slots:     Math.floor(effective / MAX_GROSS_MULT.slots),
    roulette:  Math.floor(effective / MAX_GROSS_MULT.roulette),
    baccarat:  Math.floor(effective / MAX_GROSS_MULT.baccarat),
    videopoker: Math.floor(effective / MAX_GROSS_MULT.videopoker),
    craps:     Math.floor(effective / MAX_GROSS_MULT.craps),
    liq, outstanding, effective,
  };
}
