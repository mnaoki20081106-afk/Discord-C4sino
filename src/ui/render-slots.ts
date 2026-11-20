import { createCanvas, SKRSContext2D } from '@napi-rs/canvas';
import type { Symbol as SlotSym } from '../games/slots.js';

const W = 720, H = 480;

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export interface RenderSlotsInput {
  reels: SlotSym[];        // 3つ (中央の表示)
  above?: SlotSym[];        // 上に見えるシンボル (回転中の演出用)
  below?: SlotSym[];
  bet: number;
  balance: number;
  payoutMult: number;
  spinning: boolean;
  label?: string;           // 'BIG WIN' など
}

export async function renderSlots(i: RenderSlotsInput): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // 筐体背景
  const bg = ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0, '#2d0a4e');
  bg.addColorStop(1, '#1a0330');
  ctx.fillStyle = bg;
  ctx.fillRect(0,0,W,H);

  // ネオン枠
  ctx.strokeStyle = '#ff3fa4';
  ctx.lineWidth = 4;
  ctx.shadowColor = '#ff3fa4';
  ctx.shadowBlur = 20;
  roundRect(ctx, 20, 20, W-40, H-40, 20);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // タイトル
  ctx.fillStyle = '#ffd93d';
  ctx.font = 'bold 32px serif';
  ctx.textAlign = 'center';
  ctx.shadowColor = '#ff8800'; ctx.shadowBlur = 10;
  ctx.fillText('★ C4SINO SLOTS ★', W/2, 70);
  ctx.shadowBlur = 0;

  // リール筐体
  const reelW = 130, reelH = 260, gap = 20;
  const totalW = reelW*3 + gap*2;
  const startX = (W - totalW)/2;
  const reelY = 110;

  for (let r = 0; r < 3; r++) {
    const x = startX + r*(reelW+gap);
    // リール背景
    ctx.fillStyle = '#0a0a0a';
    roundRect(ctx, x, reelY, reelW, reelH, 12);
    ctx.fill();
    ctx.strokeStyle = '#ffd93d';
    ctx.lineWidth = 2;
    roundRect(ctx, x, reelY, reelW, reelH, 12);
    ctx.stroke();

    // 上・中・下シンボル
    const above = i.above?.[r];
    const below = i.below?.[r];
    const main  = i.reels[r];

    ctx.font = '70px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (above) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillText(above.id, x+reelW/2, reelY + 50);
    }
    ctx.fillStyle = '#fff';
    ctx.fillText(main.id, x+reelW/2, reelY + reelH/2);
    if (below) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillText(below.id, x+reelW/2, reelY + reelH - 50);
    }

    // ペイライン
    ctx.strokeStyle = i.payoutMult > 0 && !i.spinning ? '#ffd93d' : 'rgba(255,217,61,0.3)';
    ctx.lineWidth = i.payoutMult > 0 && !i.spinning ? 3 : 1;
    ctx.beginPath();
    ctx.moveTo(x+6, reelY + reelH/2);
    ctx.lineTo(x+reelW-6, reelY + reelH/2);
    ctx.stroke();
  }

  // 情報バー
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffd93d';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(`BET  ${i.bet.toLocaleString()}`, 50, H-50);
  ctx.textAlign = 'right';
  ctx.fillText(`BALANCE  ${i.balance.toLocaleString()}`, W-50, H-50);

  ctx.textAlign = 'center';
  if (i.spinning) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('SPINNING…', W/2, H-50);
  } else if (i.payoutMult > 0) {
    const win = i.bet * i.payoutMult;
    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 26px sans-serif';
    ctx.shadowColor = '#22c55e'; ctx.shadowBlur = 15;
    ctx.fillText(`${i.label ?? 'WIN'}  +${win.toLocaleString()}`, W/2, H-45);
    ctx.shadowBlur = 0;
  } else {
    ctx.fillStyle = '#9ca3af';
    ctx.font = '18px sans-serif';
    ctx.fillText('— no win —', W/2, H-50);
  }

  return await canvas.encode('png');
}
