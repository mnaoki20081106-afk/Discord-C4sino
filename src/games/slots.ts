import { randomInt } from 'node:crypto';

// シンボル。重み(合計=100)でRTP調整。現状 RTP ~ 94-96%
export const SYMBOLS = [
  { id: '🍒', w: 28, pay3: 5,   pay2: 1   },
  { id: '🍋', w: 22, pay3: 8,   pay2: 0   },
  { id: '🍊', w: 16, pay3: 12,  pay2: 0   },
  { id: '🍉', w: 12, pay3: 20,  pay2: 0   },
  { id: '⭐', w: 10, pay3: 40,  pay2: 0   },
  { id: '🔔', w:  7, pay3: 80,  pay2: 0   },
  { id: '💎', w:  4, pay3: 200, pay2: 0   },
  { id: '7️⃣', w: 1, pay3: 1000, pay2: 0   },
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
  // チェリー2枚: 左から2つ連続
  if (reels[0].id === '🍒' && reels[1].id === '🍒') {
    return { reels, payoutMult: SYMBOLS[0].pay2, line: '2-cherry' };
  }
  return { reels, payoutMult: 0, line: 'none' };
}

/** 回転アニメ用: 停止位置の周辺を混ぜたリールストリップを返す */
export function reelStrip(final: Symbol, length = 12): Symbol[] {
  const strip: Symbol[] = [];
  for (let i = 0; i < length - 1; i++) strip.push(spinReel());
  strip.push(final);
  return strip;
}
