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
 * Craps 専用: アクティブなセッションの未決済最大 gross 合計を管理し、
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

/** 全ウォレットの流動性 (JPY)。PayPay はキャッシュ値、LTC は BlockCypher 残高×レート。 */
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
      let jpy = w.balance_cached ?? 0;
      if (opts?.refresh && w.access_token) {
        try {
          const b = await wallets.withPaypay(w, t => pp.walletBalance(t));
          jpy = b.usable_balance;
          wallets.touchUsed(w.id, jpy);
        } catch (e) {
          console.warn(`[liquidity] paypay #${w.id}:`, (e as Error).message);
        }
      }
      paypayTotal += jpy;
      details.push({ id: w.id, kind: 'paypay', label: w.label, jpy });
    } else if (w.kind === 'ltc' && w.address && ltcRate) {
      let jpy = 0;
      try {
        const ltc = await addressBalanceLtc(w.address);
        jpy = Math.floor(ltc * ltcRate);
      } catch (e) {
        console.warn(`[liquidity] ltc #${w.id}:`, (e as Error).message);
      }
      ltcTotal += jpy;
      details.push({ id: w.id, kind: 'ltc', label: w.label, jpy });
    }
  }

  return { total: paypayTotal + ltcTotal, paypay: paypayTotal, ltc: ltcTotal, details };
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
