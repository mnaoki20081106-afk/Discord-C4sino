import { createCanvas } from '@napi-rs/canvas';
import type { Card } from '../games/blackjack.js';
import { drawCardFace, CARD_W } from './cards.js';

const W = 640, H = 350;

export interface BacRenderInput {
  player: Card[];
  banker: Card[];
}

export async function renderBaccarat(i: BacRenderInput): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // 暗背景
  ctx.fillStyle = '#2b2d31';
  ctx.fillRect(0, 0, W, H);

  // PLAYER 側 左列
  ctx.fillStyle = '#9ca3af';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('PLAYER', W/4, 20);
  const drawRow = (cards: Card[], cx: number) => {
    const n = cards.length;
    const gap = 12;
    const totalW = CARD_W * n + gap * (n - 1);
    const startX = cx - totalW/2;
    for (let k = 0; k < n; k++) drawCardFace(ctx, cards[k], startX + k*(CARD_W+gap), 40);
  };
  drawRow(i.player, W/4);

  // BANKER 側 右列
  ctx.fillStyle = '#9ca3af';
  ctx.fillText('BANKER', (3*W)/4, 20);
  drawRow(i.banker, (3*W)/4);

  return canvas.encode('png');
}
