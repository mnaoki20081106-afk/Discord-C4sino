import { randomInt } from 'node:crypto';

// シンボル。重み(合計=100)。配当はオンカジ的 RTP ≈ 94–95% に調整済み。
export const SYMBOLS = [
  { id: '🍒', w: 28, pay3: 12,   pay2: 2   },
  { id: '🍋', w: 22, pay3: 18,   pay2: 0   },
  { id: '🍊', w: 16, pay3: 28,   pay2: 0   },
  { id: '🍉', w: 12, pay3: 46,   pay2: 0   },
  { id: '⭐', w: 10, pay3: 92,   pay2: 0   },
  { id: '🔔', w:  7, pay3: 184,  pay2: 0   },
  { id: '💎', w:  4, pay3: 460,  pay2: 0   },
  { id: '7️⃣', w: 1, pay3: 2300, pay2: 0   },
] as const;
export type Symbol = typeof SYMBOLS[number];

const TOTAL_W = SYMBOLS.reduce((s, x) => s + x.w, 0);

export function spinReel(): Symbol {
  let r = randomInt(0, TOTAL_W);
  for (const s of SYMBOLS) { if (r < s.w) return s; r -= s.w; }
  return SYMBOLS[0];
}

export interface SpinResult {
  reels: Symbol[];
  payoutMult: number;        // bet に掛ける倍率
  line: '3-of-a-kind' | '2-cherry' | 'none';
}

export function spin(): SpinResult {
  const reels = [spinReel(), spinReel(), spinReel()];
  if (reels[0].id === reels[1].id && reels[1].id === reels[2].id) {
    return { reels, payoutMult: reels[0].pay3, line: '3-of-a-kind' };
  }
  if (reels[0].id === '🍒' && reels[1].id === '🍒') {
    return { reels, payoutMult: SYMBOLS[0].pay2, line: '2-cherry' };
  }
  return { reels, payoutMult: 0, line: 'none' };
}

/** 払出が上限を超えない結果が出るまで回し直す (最大 64 回)。 */
export function spinWithCap(bet: number, payCap: number): SpinResult {
  const MAX = 64;
  for (let i = 0; i < MAX; i++) {
    const r = spin();
    if (bet * r.payoutMult <= payCap) return r;
  }
  // それでも超える場合: ハズレ結果を強制生成
  let r: SpinResult;
  do { r = spin(); } while (r.payoutMult !== 0);
  return r;
}

/** 回転アニメ用: 停止位置の周辺を混ぜたリールストリップを返す */
export function reelStrip(final: Symbol, length = 12): Symbol[] {
  const strip: Symbol[] = [];
  for (let i = 0; i < length - 1; i++) strip.push(spinReel());
  strip.push(final);
  return strip;
}
