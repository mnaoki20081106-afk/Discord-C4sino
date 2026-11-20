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

/** 黒と紫の妖艶な雰囲気のカード裏。中央に紫の輝きとゴールドの紋章。 */
export function drawCardBack(ctx: SKRSContext2D, x: number, y: number, scale = 1) {
  const W = CARD_W * scale, H = CARD_H * scale;
  const cx = x + W/2, cy = y + H/2;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
  // 背景: 深黒 + 中央から紫の放射状グロー
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.9);
  g.addColorStop(0, '#3b0a5a');
  g.addColorStop(0.45, '#1a0530');
  g.addColorStop(1, '#050008');
  ctx.fillStyle = g;
  roundRect(ctx, x, y, W, H, RADIUS); ctx.fill();
  ctx.restore();

  // 外側ゴールド枠
  ctx.strokeStyle = '#c9a44a'; ctx.lineWidth = 1.5 * scale;
  roundRect(ctx, x + 2*scale, y + 2*scale, W - 4*scale, H - 4*scale, RADIUS - 1);
  ctx.stroke();

  // 内側 紫枠
  ctx.strokeStyle = 'rgba(138, 43, 226, 0.7)';
  ctx.lineWidth = 0.8 * scale;
  roundRect(ctx, x + 6*scale, y + 6*scale, W - 12*scale, H - 12*scale, RADIUS - 4);
  ctx.stroke();

  // 対角線上のアラベスク風十字
  ctx.strokeStyle = 'rgba(168, 85, 247, 0.35)';
  ctx.lineWidth = 0.6 * scale;
  for (let k = -3; k <= 3; k++) {
    ctx.beginPath();
    ctx.moveTo(x + 8*scale, y + 20*scale + k * 18*scale);
    ctx.lineTo(x + W - 8*scale, y + 20*scale + k * 18*scale + 40*scale);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + W - 8*scale, y + 20*scale + k * 18*scale);
    ctx.lineTo(x + 8*scale, y + 20*scale + k * 18*scale + 40*scale);
    ctx.stroke();
  }

  // 中央: ダイヤモンド型ゴールド紋章 + 内側の紫宝石
  const dh = 32 * scale;
  ctx.fillStyle = '#c9a44a';
  ctx.beginPath();
  ctx.moveTo(cx, cy - dh);
  ctx.lineTo(cx + dh * 0.55, cy);
  ctx.lineTo(cx, cy + dh);
  ctx.lineTo(cx - dh * 0.55, cy);
  ctx.closePath(); ctx.fill();
  // 紫宝石
  const inner = ctx.createRadialGradient(cx - 3*scale, cy - 3*scale, 1, cx, cy, dh * 0.6);
  inner.addColorStop(0, '#c084fc');
  inner.addColorStop(0.6, '#7c3aed');
  inner.addColorStop(1, '#2e1065');
  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.moveTo(cx, cy - dh * 0.6);
  ctx.lineTo(cx + dh * 0.33, cy);
  ctx.lineTo(cx, cy + dh * 0.6);
  ctx.lineTo(cx - dh * 0.33, cy);
  ctx.closePath(); ctx.fill();
  // ゴールドのハイライト
  ctx.strokeStyle = 'rgba(255, 220, 140, 0.6)';
  ctx.lineWidth = 0.6 * scale;
  ctx.beginPath();
  ctx.moveTo(cx - dh * 0.2, cy - dh * 0.35);
  ctx.lineTo(cx + dh * 0.15, cy - dh * 0.1);
  ctx.stroke();
}
