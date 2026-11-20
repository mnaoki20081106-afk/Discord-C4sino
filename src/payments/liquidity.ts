/**
 * カジノ運営の流動性 (JPY 換算) を計算し、ベット上限を決める。
 * 当選最大額がこの流動性を上回る場合、そのベットは受付しない。
 */
import * as wallets from './wallets.js';
import * as pp from './paypay-client.js';
import { addressBalanceLtc, ltcJpyRate } from './ltc.js';
import { db } from '../db/schema.js';

/** 各ゲームで 1 bet あたりに発生しうる最大 "gross payout" の倍率。 */
export const MAX_GROSS_MULT: Record<'blackjack'|'slots'|'roulette', number> = {
  // 4ハンド split まで可 + 各ハンド double 可 + 全ハンド勝利
  // gross payout per original bet = 4 (hands) × 2 (double) × 2 (win) = 16
  blackjack: 16,
  // 7️⃣×3 の 2300 倍
  slots: 2300,
  // straight-up (単一数字) で ×36
  roulette: 36,
};

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
export async function assertBetAffordable(game: 'blackjack'|'slots'|'roulette', bet: number): Promise<void> {
  // プレイヤー全員のプール済みチップ (= 既に債務として存在) も差し引いて考える
  const liq = await cachedLiquidity();
  const outstanding = (db.prepare('SELECT COALESCE(SUM(balance),0) s FROM users').get() as any).s as number;
  const effective = liq.total - outstanding;

  const maxPay = bet * MAX_GROSS_MULT[game];
  if (maxPay > effective) {
    throw new Error(
      `このベット額では最大 **${maxPay.toLocaleString()}** の払戻しが発生する可能性がありますが、` +
      `運営の支払可能残高は **${Math.max(0,effective).toLocaleString()}** です。\n` +
      `上限 BET: **${Math.max(0, Math.floor(effective / MAX_GROSS_MULT[game])).toLocaleString()}** まで。`
    );
  }
}

/** 現在の最大許容 BET をゲーム別に返す (UI 表示用)。 */
export async function maxAffordableBet(): Promise<{ blackjack: number; slots: number; roulette: number; liq: Awaited<ReturnType<typeof totalLiquidityJpy>>; outstanding: number; effective: number }> {
  const liq = await cachedLiquidity();
  const outstanding = (db.prepare('SELECT COALESCE(SUM(balance),0) s FROM users').get() as any).s as number;
  const effective = Math.max(0, liq.total - outstanding);
  return {
    blackjack: Math.floor(effective / MAX_GROSS_MULT.blackjack),
    slots:     Math.floor(effective / MAX_GROSS_MULT.slots),
    roulette:  Math.floor(effective / MAX_GROSS_MULT.roulette),
    liq, outstanding, effective,
  };
}
