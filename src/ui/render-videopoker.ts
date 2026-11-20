import { createCanvas } from '@napi-rs/canvas';
import type { Card } from '../games/blackjack.js';
import { drawCardFace, CARD_W, CARD_H } from './cards.js';

const W = 560, H = 260;

export interface VPRenderInput {
  cards: Card[];
  held: boolean[];
  phase: 'deal' | 'drawn';
}

export async function renderVideoPoker(i: VPRenderInput): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // 暗背景
  ctx.fillStyle = '#2b2d31';
  ctx.fillRect(0, 0, W, H);

  // 5 枚のカード
  const gap = 14;
  const totalW = CARD_W * 5 + gap * 4;
  const startX = (W - totalW) / 2;
  const cy = 30;
  for (let k = 0; k < 5; k++) {
    const x = startX + k * (CARD_W + gap);
    drawCardFace(ctx, i.cards[k], x, cy);
    // HELD ラベル
    if (i.held[k]) {
      ctx.fillStyle = '#c9a44a';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#c9a44a'; ctx.shadowBlur = 8;
      ctx.fillText('HELD', x + CARD_W/2, cy + CARD_H + 20);
      ctx.shadowBlur = 0;
    }
  }

  return canvas.encode('png');
}
