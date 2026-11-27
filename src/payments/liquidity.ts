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

/** PayPay 由来 / LTC 由来の内訳 (円)。運営の残高は、この 2 つを混ぜずに別々に数える。 */
export interface Rails { pp: number; ltc: number }

/** BET の内訳で払戻しを PayPay / LTC に分ける。`payoutByMix` (db/schema.ts) と同じ丸め方。 */
export function splitByMix(amount: number, mix?: Rails): Rails {
  if (amount <= 0) return { pp: 0, ltc: 0 };
  const total = mix ? mix.pp + mix.ltc : 0;
  if (!mix || total <= 0) return { pp: amount, ltc: 0 };
  const ltc = Math.floor(amount * mix.ltc / total);
  return { pp: amount - ltc, ltc };
}

/**
 * 進行中のゲーム (全ゲーム): 払う可能性のある最大額を session ID ごとに持ち、
 * 他の人の上限計算から差し引く (同時に遊ばれても合計で運営の残高を超えないため)。
 * PayPay 由来の分は運営の PayPay、LTC 由来の分は運営の LTC だけに充てる。
 */
const exposures = new Map<string, Rails>();
export function setExposure(sessionId: string, rails: Rails) {
  exposures.set(sessionId, { pp: Math.max(0, rails.pp), ltc: Math.max(0, rails.ltc) });
}
export function clearExposure(sessionId: string) {
  exposures.delete(sessionId);
}
/** 金額 1 つ + 内訳で確保する版 (マインスイーパー用)。 */
export function setCrapsExposure(sessionId: string, maxGross: number, mix?: Rails) {
  setExposure(sessionId, splitByMix(maxGross, mix));
}
export const clearCrapsExposure = clearExposure;

function exposureTotals(exceptSessionId?: string): Rails {
  let pp = 0, ltc = 0;
  for (const [id, v] of exposures) if (id !== exceptSessionId) { pp += v.pp; ltc += v.ltc; }
  return { pp, ltc };
}
function totalCrapsExposure(exceptSessionId?: string): number {
  const t = exposureTotals(exceptSessionId);
  return t.pp + t.ltc;
}

/** 運営ウォレットの帳簿残高 (JPY) を PayPay / LTC 別に。ローカル帳簿 (`balance_cached`) を都度読む同期処理。 */
export function railLiquidity(): Rails {
  let pp = 0, ltc = 0;
  for (const w of wallets.listWallets()) {
    if (!w.enabled) continue;
    const jpy = Math.max(0, w.balance_cached ?? 0);
    if (w.kind === 'paypay') pp += jpy;
    else if (w.kind === 'ltc' && w.address) ltc += jpy;
  }
  return { pp, ltc };
}

/** ユーザーが持っているチップの合計 (PayPay 由来 / LTC 由来) = 運営の債務。 */
export function railOutstanding(): Rails {
  const r = db.prepare('SELECT COALESCE(SUM(pp_reserve),0) pp, COALESCE(SUM(ltc_reserve),0) ltc FROM users').get() as Rails;
  return { pp: r.pp, ltc: r.ltc };
}

/**
 * 「運営が今この瞬間にあと払える額」を PayPay / LTC 別に返す (同期)。
 *   運営ウォレット − ユーザーのチップ − 他の進行中のゲームが確保している額
 * exceptSessionId の台は自分の分なので差し引かない。
 */
export function railCap(exceptSessionId?: string): Rails {
  const L = railLiquidity(), O = railOutstanding(), X = exposureTotals(exceptSessionId);
  return { pp: Math.max(0, L.pp - O.pp - X.pp), ltc: Math.max(0, L.ltc - O.ltc - X.ltc) };
}

/** need が cap に収まるか。収まらないレールがあれば、その不足額も返す。 */
export function railShortfall(need: Rails, cap: Rails): { ok: boolean; pp: number; ltc: number } {
  const pp = Math.max(0, need.pp - cap.pp), ltc = Math.max(0, need.ltc - cap.ltc);
  return { ok: pp === 0 && ltc === 0, pp, ltc };
}

/**
 * この BET の内訳で払うとき、PayPay / LTC のどちらも運営の払える額を超えない最大の払戻し額。
 * 内訳が無い (壊れたデータ) 場合は、どちらのレールで払っても足りる額にする。
 */
export function maxPayoutForMix(mix: Rails | undefined, exceptSessionId?: string): number {
  const cap = railCap(exceptSessionId);
  const total = mix ? mix.pp + mix.ltc : 0;
  if (!mix || total <= 0) return Math.min(cap.pp, cap.ltc);
  let hi = Number.MAX_SAFE_INTEGER;
  if (mix.pp > 0)  hi = Math.min(hi, Math.floor(cap.pp * total / mix.pp));
  if (mix.ltc > 0) hi = Math.min(hi, Math.floor(cap.ltc * total / mix.ltc));
  // 丸めで 1 円ずれても超えないよう、実際の分け方で確かめる
  while (hi > 0) {
    const s = splitByMix(hi, mix);
    if (s.pp <= cap.pp && s.ltc <= cap.ltc) break;
    hi--;
  }
  return Math.max(0, hi);
}

/**
 * BET を受ける前の判定: この BET の最大払戻し (元の額込み) が、運営の払える額に収まるか。
 * BET の元の額は引き落としで運営の債務から外れるので、そのぶん (mix.pp / mix.ltc) は余裕に足す。
 */
export function maxGrossFits(maxGross: number, mix: Rails, exceptSessionId?: string): boolean {
  const need = splitByMix(maxGross, mix), cap = railCap(exceptSessionId);
  return need.pp <= cap.pp + mix.pp && need.ltc <= cap.ltc + mix.ltc;
}

/** 同じ PayPay / LTC の比率のまま置ける最大の BET 額 (最大払戻しが BET の maxMult 倍のとき)。 */
export function maxBetFor(maxMult: number, mix: Rails, exceptSessionId?: string): number {
  const total = mix.pp + mix.ltc;
  if (total <= 0 || maxMult <= 0) return 0;
  const fits = (b: number) => maxGrossFits(Math.ceil(b * maxMult), splitByMix(b, mix), exceptSessionId);
  let lo = 0, hi = total;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid; else hi = mid - 1;
  }
  return lo;
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
  // 進行中のゲーム (マインスイーパー・クラップス・BJ・VP) が払う可能性のある額も、引き出せる額から除く
  const resX = exposureTotals();
  const reserved = resX.pp + resX.ltc;
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
  // そのレールの進行中のゲームの確保分も、そのレールの残高から守る (PayPay と LTC を混ぜない)
  const railReserved = kind === 'paypay' ? resX.pp : resX.ltc;
  const railNeed = reservesByRail.s + railReserved;
  if (walletRailJpy - amountJpy < railNeed) {
    const deficit = railNeed - (walletRailJpy - amountJpy);
    return `${kind.toUpperCase()} 側で ¥${deficit.toLocaleString()} 分不足します ` +
      `(${kind.toUpperCase()} 残高 ¥${walletRailJpy.toLocaleString()} − 引き出し ¥${amountJpy.toLocaleString()} < ${kind.toUpperCase()} 由来チップ ¥${reservesByRail.s.toLocaleString()} + 進行中のゲームで確保 ¥${railReserved.toLocaleString()})`;
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
  const X = exposureTotals();
  const reserved = X.pp + X.ltc;
  return { max: Math.max(0, liq.total - outstanding - reserved), total: liq.total, outstanding, reserved };
}

/**
 * 「ハウスが今この瞬間に払える gross 上限」。bet は既に台に乗っている想定で、
 * 実際に wallet から流出するのは payout - その bet 分だが、安全側に effective 全体を返す。
 *
 * mix (その BET の PayPay / LTC 内訳) を渡すと、PayPay 由来は運営の PayPay 残高、LTC 由来は運営の LTC 残高
 * だけで判定する (混ぜない)。mix を渡さない呼び出しは従来どおり合計で判定する。
 */
export async function housePayoutCap(exceptSessionId?: string, mix?: Rails): Promise<number> {
  if (mix) return maxPayoutForMix(mix, exceptSessionId);
  const liq = await cachedLiquidity();
  const outstanding = (db.prepare('SELECT COALESCE(SUM(balance),0) s FROM users').get() as any).s as number;
  return Math.max(0, liq.total - outstanding - totalCrapsExposure(exceptSessionId));
}

/**
 * 最終防衛線: 実際に chip 加算する直前に呼ぶ。
 * 現在の housePayoutCap を越えないよう amount をクランプして返す。
 */
export async function clampPayout(amount: number, exceptSessionId?: string, mix?: Rails): Promise<number> {
  if (amount <= 0) return 0;
  const cap = await housePayoutCap(exceptSessionId, mix);
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
