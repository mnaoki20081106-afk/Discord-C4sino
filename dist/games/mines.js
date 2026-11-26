/**
 * マインスイーパー (カジノの Mines)。
 *
 * N×N のマスに爆弾を M 個隠す。宝石のマスを開けるほど倍率が上がり、いつでも CASH OUT できる。
 * 爆弾を開けたら BET は没収。
 *
 * 倍率 = 本来の確率どおりの倍率 × (1 − ハウスエッジ)。小数 2 桁で切り捨て。
 *   k マス開けたときの本来の倍率 = Π_{i=0}^{k-1} (N² − i) / (N² − M − i)
 * どこで CASH OUT しても還元率は (1 − ハウスエッジ) 以下になる。
 */
import { randomInt } from 'node:crypto';
export const MINES_SIZES = [3, 4];
export const HOUSE_EDGE = 0.03;
/** 'NxN:M' (例 '4x4:3') を読む。不正なら既定値。 */
export function parseOpt(opt) {
    const m = /^(\d)x\1:(\d+)$/.exec(opt);
    const size = (m && MINES_SIZES.includes(Number(m[1])) ? Number(m[1]) : 4);
    const mines = m ? Number(m[2]) : 3;
    return { size, mines: mines >= 1 && mines <= size * size - 1 ? mines : Math.min(3, size * size - 1) };
}
export const optOf = (size, mines) => `${size}x${size}:${mines}`;
export function newMines(size, mines) {
    const n = size * size;
    if (!Number.isInteger(mines) || mines < 1 || mines > n - 1)
        throw new Error('爆弾の数が不正です');
    const bombs = Array(n).fill(false);
    // Fisher–Yates の先頭 mines 個を爆弾にする (暗号学的乱数)
    const idx = Array.from({ length: n }, (_, k) => k);
    for (let k = 0; k < mines; k++) {
        const j = k + randomInt(n - k);
        [idx[k], idx[j]] = [idx[j], idx[k]];
        bombs[idx[k]] = true;
    }
    return { size, mines, bombs, opened: Array(n).fill(false), phase: 'play' };
}
/** 開けた宝石の数 (踏んだ爆弾は数えない) */
export const openedCount = (st) => st.opened.filter((o, k) => o && !st.bombs[k]).length;
export const safeCount = (st) => st.size * st.size - st.mines;
/** k マス開けたときの倍率 (k=0 は 1)。 */
export function multiplier(size, mines, k) {
    if (k <= 0)
        return 1;
    const n = size * size;
    let fair = 1;
    for (let i = 0; i < k; i++)
        fair *= (n - i) / (n - mines - i);
    return Math.floor(fair * (1 - HOUSE_EDGE) * 100 + 1e-9) / 100;
}
/** 払戻し (円)。 */
export const payoutOf = (bet, size, mines, k) => Math.floor(bet * multiplier(size, mines, k));
/** マスを開ける。開けられないマス (開け済み・終了後) なら何もしない。 */
export function openCell(st, cell) {
    if (st.phase !== 'play' || cell < 0 || cell >= st.opened.length || st.opened[cell])
        return 'noop';
    st.opened[cell] = true;
    if (st.bombs[cell]) {
        st.phase = 'bust';
        st.hit = cell;
        return 'bomb';
    }
    return 'safe';
}
