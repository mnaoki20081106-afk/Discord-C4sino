// カード描画ヘルパー (共用)。render-table.ts と似たスタイルで単独描画。
import { SKRSContext2D } from '@napi-rs/canvas';
import type { Card } from '../games/blackjack.js';

export const CARD_W = 90, CARD_H = 130, RADIUS = 10;

const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' } as const;
const SUIT_COLOR = { S: '#111', H: '#c62828', D: '#c62828', C: '#111' } as const;

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawCardFace(ctx: SKRSContext2D, c: Card, x: number, y: number, scale = 1) {
  const W = CARD_W * scale, H = CARD_H * scale;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#fafafa';
  roundRect(ctx, x, y, W, H, RADIUS);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = '#d0d0d0'; ctx.lineWidth = 1;
  roundRect(ctx, x, y, W, H, RADIUS); ctx.stroke();

  ctx.fillStyle = SUIT_COLOR[c.suit];
  ctx.font = `bold ${22*scale}px sans-serif`;
  ctx.textBaseline = 'top'; ctx.textAlign = 'start';
  ctx.fillText(c.rank === 'T' ? '10' : c.rank, x + 8*scale, y + 6*scale);
  ctx.font = `${20*scale}px sans-serif`;
  ctx.fillText(SUIT_GLYPH[c.suit], x + 8*scale, y + 30*scale);

  ctx.font = `bold ${44*scale}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(SUIT_GLYPH[c.suit], x + W/2, y + H/2);
  ctx.textAlign = 'start';
}

export function drawCardBack(ctx: SKRSContext2D, x: number, y: number, scale = 1) {
  const W = CARD_W * scale, H = CARD_H * scale;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
  const g = ctx.createLinearGradient(x, y, x + W, y + H);
  g.addColorStop(0, '#1e3a8a'); g.addColorStop(1, '#4c1d95');
  ctx.fillStyle = g;
  roundRect(ctx, x, y, W, H, RADIUS); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2;
  roundRect(ctx, x + 5*scale, y + 5*scale, W - 10*scale, H - 10*scale, RADIUS - 4); ctx.stroke();
}
