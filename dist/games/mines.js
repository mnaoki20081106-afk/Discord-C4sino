/**
 * マインスイーパー (カジノの Mines)。
 *
 * N×N のマスに爆弾を M 個隠す。宝石のマスを開けるほど倍率が上がり、いつでも CASH OUT できる。
 * 爆弾を開けたら BET は没収。
 *
 * 倍率 = 本来の確率どおりの倍率 × (1 − ハウスエッジ)。小数 2 桁で切り捨て。
 *   k マス開けたときの本来の倍率 = Π_{i=0}^{k-1} (N² − i) / (N² − M − i)
 * どこで CASH OUT しても還元率は (1 − ハウスエッジ) 以下になる。
 *
 * 爆弾は盤面に先に置くのではなく、マスを開けるたびに「残りの未開封マスのうち残りの
 * 爆弾の割合」で決める (フィッシャー・イェーツを後ろから回すのと同じ確率分布)。
 * この時、宝石の数が `gemCap` を超えそうなら、そのマスは必ず爆弾になる — 運営の残高を
 * 超える払戻しがそもそも発生しないようにする。gemCap = 開けて良い宝石の最大数で、
 * bet × 倍率(k) ≤ 運営の払える額 を満たす最大の k を BET 時に決める。
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
export function newMines(size, mines, gemCap) {
    const n = size * size;
    if (!Number.isInteger(mines) || mines < 1 || mines > n - 1)
        throw new Error('爆弾の数が不正です');
    const sc = n - mines;
    return {
        size, mines,
        bombs: Array(n).fill(false),
        opened: Array(n).fill(false),
        phase: 'play',
        gemCap: Math.max(0, Math.min(sc, gemCap ?? sc)),
    };
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
    const n = st.size * st.size;
    const openedBefore = st.opened.filter(Boolean).length; // play 中は全部宝石
    const unopenedBefore = n - openedBefore;
    const bombsRemaining = st.mines - st.bombs.filter(Boolean).length;
    // 宝石の上限を超えそうなら必ず爆弾。それ以外は残りの比率で決める
    const forceBomb = openedBefore + 1 > st.gemCap;
    const isBomb = forceBomb || randomInt(unopenedBefore) < bombsRemaining;
    st.opened[cell] = true;
    if (isBomb) {
        st.bombs[cell] = true;
        st.phase = 'bust';
        st.hit = cell;
        revealRemaining(st);
        return 'bomb';
    }
    return 'safe';
}
/** 終了時: 未開封マスに残りの爆弾をランダムに置いて表示用に揃える。多重呼び出しは noop。 */
export function revealRemaining(st) {
    const n = st.size * st.size;
    const remaining = st.mines - st.bombs.filter(Boolean).length;
    if (remaining <= 0)
        return;
    const idx = [];
    for (let i = 0; i < n; i++)
        if (!st.opened[i] && !st.bombs[i])
            idx.push(i);
    for (let i = 0; i < remaining && i < idx.length; i++) {
        const j = i + randomInt(idx.length - i);
        [idx[i], idx[j]] = [idx[j], idx[i]];
        st.bombs[idx[i]] = true;
    }
}
