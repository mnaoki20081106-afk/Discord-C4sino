/**
 * 残高ゲージ (絵文字)。PayPay 由来と LTC 由来の割合を 10 マス・5% 刻みで表す。
 *
 * 埋め込みの中のアプリ絵文字は文字と同じ大きさ (約 22px) で出るので、10 マスで約 220px。
 * スマホの狭い埋め込み (280px 前後) でも 1 行に収まる。見出し (#) で大きくすると 1 マス約 48px に
 * なって改行されるので、ゲージは普通の大きさの行に置き、マスの間に空白も入れないこと。
 */
import { emoji } from './emoji-ids.js';
export const GAUGE_CELLS = 10;
/** 各マスの種類。半マス単位で四捨五入し、境目のマスは左半分 PayPay / 右半分 LTC。 */
export function gaugeCells(pp, ltc) {
    const total = pp + ltc;
    if (total <= 0)
        return Array(GAUGE_CELLS).fill('empty');
    const half = Math.round((pp / total) * GAUGE_CELLS * 2);
    return Array.from({ length: GAUGE_CELLS }, (_, k) => {
        const u = Math.max(0, Math.min(2, half - 2 * k));
        return u === 2 ? 'pp' : u === 1 ? 'mix' : 'ltc';
    });
}
/** ゲージ 1 行分の文字列。絵文字が未登録なら ▰ / ▱ の文字で代わりに出す。 */
export function emojiGauge(pp, ltc) {
    const cells = gaugeCells(pp, ltc);
    const parts = cells.map((kind, k) => emoji(`gauge_${kind}_${k === 0 ? 'l' : k === GAUGE_CELLS - 1 ? 'r' : 'm'}`));
    if (parts.every(Boolean))
        return parts.join('');
    return cells.map(kind => (kind === 'empty' ? '▱' : '▰')).join('');
}
