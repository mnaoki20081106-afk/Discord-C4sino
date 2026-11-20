import { createCanvas, SKRSContext2D } from '@napi-rs/canvas';
import type { Symbol as SlotSym } from '../games/slots.js';

const W = 560, H = 320;

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

/** リール 3 本だけを描く。背景は Discord の暗色に馴染ませる。 */
export async function renderSlots(i: RenderSlotsInput): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // 背景: 黒ベース
  ctx.fillStyle = '#2b2d31';
  ctx.fillRect(0, 0, W, H);

  // 筐体パネル (深紅 + 金枠)
  const panelX = 20, panelY = 20;
  const panelW = W - 40, panelH = H - 40;
  const gradBG = ctx.createLinearGradient(0, panelY, 0, panelY + panelH);
  gradBG.addColorStop(0, '#2a0808');
  gradBG.addColorStop(1, '#100000');
  ctx.fillStyle = gradBG;
  roundRect(ctx, panelX, panelY, panelW, panelH, 14); ctx.fill();
  ctx.strokeStyle = '#c9a44a'; ctx.lineWidth = 2;
  roundRect(ctx, panelX, panelY, panelW, panelH, 14); ctx.stroke();

  // リール窓
  const reelW = 140, reelH = 240, gap = 16;
  const totalW = reelW*3 + gap*2;
  const startX = (W - totalW)/2;
  const reelY = 40;

  for (let r = 0; r < 3; r++) {
    const x = startX + r*(reelW+gap);

    // リール背景 (深黒)
    ctx.fillStyle = '#050505';
    roundRect(ctx, x, reelY, reelW, reelH, 10); ctx.fill();
    ctx.strokeStyle = '#c9a44a'; ctx.lineWidth = 1.5;
    roundRect(ctx, x, reelY, reelW, reelH, 10); ctx.stroke();

    // 上下シンボル (薄)
    const above = i.above?.[r];
    const below = i.below?.[r];
    const main  = i.reels[r];

    ctx.font = '72px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (above) { ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillText(above.id, x+reelW/2, reelY + 44); }
    if (below) { ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillText(below.id, x+reelW/2, reelY + reelH - 44); }

    // メインシンボル
    ctx.fillStyle = '#fff';
    ctx.fillText(main.id, x+reelW/2, reelY + reelH/2);

    // ペイライン
    ctx.strokeStyle = i.payoutMult > 0 && !i.spinning ? '#f6c84c' : 'rgba(201,164,74,0.3)';
    ctx.lineWidth = i.payoutMult > 0 && !i.spinning ? 3 : 1;
    ctx.beginPath();
    ctx.moveTo(x+6, reelY + reelH/2);
    ctx.lineTo(x+reelW-6, reelY + reelH/2);
    ctx.stroke();
  }

  return canvas.encode('png');
}
