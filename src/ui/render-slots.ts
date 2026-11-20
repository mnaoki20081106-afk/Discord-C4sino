import { createCanvas, SKRSContext2D } from '@napi-rs/canvas';
import type { Symbol as SlotSym } from '../games/slots.js';

const W = 460, H = 260;

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

export interface RenderSlotsInput {
  reels: SlotSym[];
  above?: SlotSym[];
  below?: SlotSym[];
  bet: number;
  balance: number;
  payoutMult: number;
  spinning: boolean;
  label?: string;
}

/** 暗背景にリール 3 本だけ。シンプル。 */
export async function renderSlots(i: RenderSlotsInput): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#2b2d31';
  ctx.fillRect(0, 0, W, H);

  const reelW = 120, reelH = 200, gap = 18;
  const totalW = reelW*3 + gap*2;
  const startX = (W - totalW)/2;
  const reelY = (H - reelH)/2;

  for (let r = 0; r < 3; r++) {
    const x = startX + r*(reelW+gap);

    // 白リール窓 (トランプのような清潔感)
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#fafafa';
    roundRect(ctx, x, reelY, reelW, reelH, 10); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#d0d0d0'; ctx.lineWidth = 1;
    roundRect(ctx, x, reelY, reelW, reelH, 10); ctx.stroke();

    // 上下シンボル (薄グレー)
    const above = i.above?.[r];
    const below = i.below?.[r];
    const main  = i.reels[r];

    ctx.font = '60px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (above) { ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillText(above.id, x+reelW/2, reelY + 36); }
    if (below) { ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillText(below.id, x+reelW/2, reelY + reelH - 36); }

    // メイン
    ctx.fillStyle = '#111';
    ctx.fillText(main.id, x+reelW/2, reelY + reelH/2);

    // 当選時の金ペイライン
    if (i.payoutMult > 0 && !i.spinning) {
      ctx.strokeStyle = '#c9a44a'; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x+6, reelY + reelH/2);
      ctx.lineTo(x+reelW-6, reelY + reelH/2);
      ctx.stroke();
    }
  }

  return canvas.encode('png');
}
