/**
 * カジノ運営の流動性 (JPY 換算) を計算し、ベット上限を決める。
 * 当選最大額がこの流動性を上回る場合、そのベットは受付しない。
 */
import * as wallets from './wallets.js';
import * as pp from './paypay-client.js';
import { addressBalanceLtc, ltcJpyRate } from './ltc.js';
import { db } from '../db/schema.js';
export const MAX_GROSS_MULT = {
    blackjack: 16, // 4 hands × double × win
    slots: 2300, // 7️⃣×3
    roulette: 36, // straight-up
    baccarat: 9, // Tie
    videopoker: 800, // Royal Flush
    craps: 31, // 30:1 snake-eyes / boxcars (最大)
};
/**
 * Craps 専用: アクティブなセッションの未決済最大 gross 合計を管理し、
 * 合算で流動性を超えないよう検査する。
 */
const crapsExposures = new Map();
export function setCrapsExposure(sessionId, maxGross) {
    crapsExposures.set(sessionId, maxGross);
}
export function clearCrapsExposure(sessionId) {
    crapsExposures.delete(sessionId);
}
function totalCrapsExposure(exceptSessionId) {
    let s = 0;
    for (const [id, v] of crapsExposures)
        if (id !== exceptSessionId)
            s += v;
    return s;
}
/**
 * 全ウォレットの流動性 (JPY)。ローカル `balance_cached` を唯一の真実とする。
 * 外部システム (PayPay API / BlockCypher) の反映遅延に依らず、入出金の都度 adjustCached で
 * 更新されているローカル帳簿を参照する。opts.refresh=true の時だけ外部と同期する。
 */
export async function totalLiquidityJpy(opts) {
    const ws = wallets.listWallets().filter(w => w.enabled);
    const details = [];
    let paypayTotal = 0;
    let ltcTotal = 0;
    const ltcRate = await ltcJpyRate().catch(() => null);
    for (const w of ws) {
        if (w.kind === 'paypay') {
            if (opts?.refresh && w.access_token) {
                try {
                    const b = await wallets.withPaypay(w, t => pp.walletBalance(t));
                    wallets.setCached(w.id, b.usable_balance);
                }
                catch (e) {
                    console.warn(`[liquidity] paypay #${w.id}:`, e.message);
                }
            }
            // refresh 済みなら再読込、それ以外は手元の cache をそのまま使う
            const jpy = (wallets.getWallet(w.id)?.balance_cached) ?? 0;
            paypayTotal += jpy;
            details.push({ id: w.id, kind: 'paypay', label: w.label, jpy });
        }
        else if (w.kind === 'ltc' && w.address && ltcRate) {
            if (opts?.refresh) {
                try {
                    const ltc = await addressBalanceLtc(w.address);
                    wallets.setCached(w.id, Math.floor(ltc * ltcRate));
                }
                catch (e) {
                    console.warn(`[liquidity] ltc #${w.id}:`, e.message);
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
export async function assertOperatorWithdrawSafe(amountJpy, kind) {
    const liq = await cachedLiquidity();
    const outstanding = db.prepare('SELECT COALESCE(SUM(balance),0) s FROM users').get().s;
    const effectiveAfter = liq.total - outstanding - amountJpy;
    if (effectiveAfter < 0) {
        return `引き出すと ¥${(-effectiveAfter).toLocaleString()} 分、流通チップに対して不足します ` +
            `(流動性 ¥${liq.total.toLocaleString()} − 流通チップ ¥${outstanding.toLocaleString()} − 引き出し ¥${amountJpy.toLocaleString()})`;
    }
    // kind 別の個別チェックも: LTC だけ引き出して LTC 由来のチップが残らないようにする
    const reservesByRail = db.prepare(kind === 'paypay'
        ? 'SELECT COALESCE(SUM(pp_reserve),0) s FROM users'
        : 'SELECT COALESCE(SUM(ltc_reserve),0) s FROM users').get();
    const walletRailJpy = kind === 'paypay' ? liq.paypay : liq.ltc;
    if (walletRailJpy - amountJpy < reservesByRail.s) {
        const deficit = reservesByRail.s - (walletRailJpy - amountJpy);
        return `${kind.toUpperCase()} 側で ¥${deficit.toLocaleString()} 分不足します ` +
            `(${kind.toUpperCase()} 残高 ¥${walletRailJpy.toLocaleString()} − 引き出し ¥${amountJpy.toLocaleString()} < ${kind.toUpperCase()} 由来チップ ¥${reservesByRail.s.toLocaleString()})`;
    }
    return null;
}
/** 流動性キャッシュ (30秒) — 高頻度ベット時に外部APIを叩きすぎない。 */
let _cache = null;
const CACHE_MS = 30_000;
export async function cachedLiquidity() {
    if (_cache && Date.now() - _cache.at < CACHE_MS)
        return _cache.liq;
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
export async function housePayoutCap(exceptCrapsSession) {
    const liq = await cachedLiquidity();
    const outstanding = db.prepare('SELECT COALESCE(SUM(balance),0) s FROM users').get().s;
    const otherCraps = totalCrapsExposure(exceptCrapsSession);
    return Math.max(0, liq.total - outstanding - otherCraps);
}
/**
 * 最終防衛線: 実際に chip 加算する直前に呼ぶ。
 * 現在の housePayoutCap を越えないよう amount をクランプして返す。
 */
export async function clampPayout(amount, exceptCrapsSession) {
    if (amount <= 0)
        return 0;
    const cap = await housePayoutCap(exceptCrapsSession);
    return Math.min(amount, cap);
}
/** 現在の最大許容 BET をゲーム別に返す (UI 表示用)。 */
export async function maxAffordableBet() {
    const liq = await cachedLiquidity();
    const outstanding = db.prepare('SELECT COALESCE(SUM(balance),0) s FROM users').get().s;
    const effective = Math.max(0, liq.total - outstanding);
    return {
        blackjack: Math.floor(effective / MAX_GROSS_MULT.blackjack),
        slots: Math.floor(effective / MAX_GROSS_MULT.slots),
        roulette: Math.floor(effective / MAX_GROSS_MULT.roulette),
        baccarat: Math.floor(effective / MAX_GROSS_MULT.baccarat),
        videopoker: Math.floor(effective / MAX_GROSS_MULT.videopoker),
        craps: Math.floor(effective / MAX_GROSS_MULT.craps),
        liq, outstanding, effective,
    };
}
