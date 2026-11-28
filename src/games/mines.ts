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

export const MINES_SIZES = [3, 4] as const;
export type MinesSize = (typeof MINES_SIZES)[number];
export const HOUSE_EDGE = 0.03;

export interface MinesState {
  size: MinesSize;
  mines: number;
  /** true が爆弾。長さ size*size */
  bombs: boolean[];
  opened: boolean[];
  phase: 'play' | 'bust' | 'cashed';
  /** 爆弾を開けたマス */
  hit?: number;
  /** 内部用: この数より多く宝石を開けようとしたら、その 1 マスを本物の爆弾と位置ごと差し替える。
   *  爆弾の総数は変えないので、ユーザーから見ると普通に「爆弾を踏んだ」ようにしか見えない。
   *  BET 時に設定され、ユーザーには表示されない。 */
  maxSafe?: number;
}

/** 'NxN:M' (例 '4x4:3') を読む。不正なら既定値。 */
export function parseOpt(opt: string): { size: MinesSize; mines: number } {
  const m = /^(\d)x\1:(\d+)$/.exec(opt);
  const size = (m && (MINES_SIZES as readonly number[]).includes(Number(m[1])) ? Number(m[1]) : 4) as MinesSize;
  const mines = m ? Number(m[2]) : 3;
  return { size, mines: mines >= 1 && mines <= size * size - 1 ? mines : Math.min(3, size * size - 1) };
}
export const optOf = (size: MinesSize, mines: number) => `${size}x${size}:${mines}`;

export function newMines(size: MinesSize, mines: number): MinesState {
  const n = size * size;
  if (!Number.isInteger(mines) || mines < 1 || mines > n - 1) throw new Error('爆弾の数が不正です');
  const bombs = Array<boolean>(n).fill(false);
  // Fisher–Yates の先頭 mines 個を爆弾にする (暗号学的乱数)
  const idx = Array.from({ length: n }, (_, k) => k);
  for (let k = 0; k < mines; k++) {
    const j = k + randomInt(n - k);
    [idx[k], idx[j]] = [idx[j], idx[k]];
    bombs[idx[k]] = true;
  }
  return { size, mines, bombs, opened: Array<boolean>(n).fill(false), phase: 'play' };
}

/** 開けた宝石の数 (踏んだ爆弾は数えない) */
export const openedCount = (st: MinesState) => st.opened.filter((o, k) => o && !st.bombs[k]).length;
export const safeCount = (st: MinesState) => st.size * st.size - st.mines;

/** k マス開けたときの倍率 (k=0 は 1)。 */
export function multiplier(size: number, mines: number, k: number): number {
  if (k <= 0) return 1;
  const n = size * size;
  let fair = 1;
  for (let i = 0; i < k; i++) fair *= (n - i) / (n - mines - i);
  return Math.floor(fair * (1 - HOUSE_EDGE) * 100 + 1e-9) / 100;
}

/** 払戻し (円)。 */
export const payoutOf = (bet: number, size: number, mines: number, k: number) => Math.floor(bet * multiplier(size, mines, k));

/** マスを開ける。開けられないマス (開け済み・終了後) なら何もしない。
 *  maxSafe を超える宝石マスに手を出した場合は、未発見の爆弾 1 つと位置を入れ替えて、
 *  そのマスを本物の爆弾にしてから開ける (爆弾の総数は変わらないので、画面上は普通の "爆弾を踏んだ" にしか見えない)。 */
export function openCell(st: MinesState, cell: number): 'safe' | 'bomb' | 'noop' {
  if (st.phase !== 'play' || cell < 0 || cell >= st.opened.length || st.opened[cell]) return 'noop';
  if (!st.bombs[cell] && st.maxSafe !== undefined && openedCount(st) + 1 > st.maxSafe) {
    const unseenBombs: number[] = [];
    for (let i = 0; i < st.bombs.length; i++) if (st.bombs[i] && !st.opened[i]) unseenBombs.push(i);
    if (unseenBombs.length > 0) {
      const swap = unseenBombs[randomInt(unseenBombs.length)];
      st.bombs[swap] = false;
      st.bombs[cell] = true;
    }
  }
  st.opened[cell] = true;
  if (st.bombs[cell]) { st.phase = 'bust'; st.hit = cell; return 'bomb'; }
  return 'safe';
}
