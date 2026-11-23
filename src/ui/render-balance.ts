import { createCanvas, SKRSContext2D } from '@napi-rs/canvas';

const W = 720, H = 220;
const PAD = 32;

const COLOR_BG      = '#1e1f22';
const COLOR_CARD    = '#2b2d31';
const COLOR_GROOVE  = '#1a1b1e';
const COLOR_MUTED   = '#949ba4';
const COLOR_TEXT    = '#f2f3f5';
const COLOR_PP      = '#d62828';
const COLOR_PP_HI   = '#ff4c4c';
const COLOR_LTC     = '#1f6feb';
const COLOR_LTC_HI  = '#4a9cff';

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function verticalGradient(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, top: string, bottom: string) {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  return g;
}

export interface BalanceRenderInput {
  pp: number;
  ltc: number;
  /** 任意の注記 (例: 入金完了後のメッセージ) */
  note?: string;
}

export async function renderBalance(input: BalanceRenderInput): Promise<Buffer> {
  const { pp, ltc, note } = input;
  const total = pp + ltc;
  const ppPct = total > 0 ? pp / total : 0;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, W, H);

  // header
  ctx.fillStyle = COLOR_MUTED;
  ctx.font = '500 16px sans-serif';
  ctx.fillText('BALANCE', PAD, PAD);

  // total amount (big)
  ctx.fillStyle = COLOR_TEXT;
  ctx.font = '700 44px sans-serif';
  const totalStr = `JPY  ${total.toLocaleString()}`;
  ctx.fillText(totalStr, PAD, PAD + 44);

  // gauge groove
  const barX = PAD;
  const barY = 108;
  const barW = W - PAD * 2;
  const barH = 28;
  roundRect(ctx, barX, barY, barW, barH, barH / 2);
  ctx.fillStyle = COLOR_GROOVE;
  ctx.fill();

  if (total > 0) {
    const ppW = Math.max(ppPct > 0 ? 2 : 0, Math.round(barW * ppPct));
    const ltcW = barW - ppW;

    // PP segment (left)
    if (ppW > 0) {
      ctx.save();
      roundRect(ctx, barX, barY, barW, barH, barH / 2);
      ctx.clip();
      ctx.fillStyle = verticalGradient(ctx, barX, barY, barW, barH, COLOR_PP_HI, COLOR_PP);
      ctx.fillRect(barX, barY, ppW, barH);
      ctx.restore();
    }
    // LTC segment (right)
    if (ltcW > 0) {
      ctx.save();
      roundRect(ctx, barX, barY, barW, barH, barH / 2);
      ctx.clip();
      ctx.fillStyle = verticalGradient(ctx, barX, barY, barW, barH, COLOR_LTC_HI, COLOR_LTC);
      ctx.fillRect(barX + ppW, barY, ltcW, barH);
      ctx.restore();
    }
  }

  // legend row
  const legendY = barY + barH + 28;
  const colW = (barW - 24) / 2;

  // PayPay card
  drawRailCard(ctx, barX, legendY, colW, 'PayPay', pp, ppPct, COLOR_PP);
  // LTC card
  drawRailCard(ctx, barX + colW + 24, legendY, colW, 'LTC', ltc, 1 - ppPct, COLOR_LTC);

  if (note) {
    ctx.fillStyle = COLOR_MUTED;
    ctx.font = '400 12px sans-serif';
    ctx.fillText(note, PAD, H - 10);
  }

  return canvas.encode('png');
}

function drawRailCard(ctx: SKRSContext2D, x: number, y: number, w: number, label: string, amount: number, pct: number, swatch: string) {
  const h = 48;
  roundRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = COLOR_CARD;
  ctx.fill();

  // swatch dot
  const dotR = 6;
  ctx.beginPath();
  ctx.arc(x + 14 + dotR, y + h / 2, dotR, 0, Math.PI * 2);
  ctx.fillStyle = swatch;
  ctx.fill();

  // label + percentage
  ctx.fillStyle = COLOR_MUTED;
  ctx.font = '500 13px sans-serif';
  ctx.fillText(label, x + 34, y + 20);

  ctx.fillStyle = COLOR_TEXT;
  ctx.font = '700 20px sans-serif';
  ctx.fillText(`¥${amount.toLocaleString()}`, x + 34, y + 40);

  // right-aligned percentage
  const pctStr = `${Math.round(pct * 100)}%`;
  ctx.fillStyle = COLOR_MUTED;
  ctx.font = '600 16px sans-serif';
  const tw = ctx.measureText(pctStr).width;
  ctx.fillText(pctStr, x + w - 14 - tw, y + h / 2 + 6);
}
