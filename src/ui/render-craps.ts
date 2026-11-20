import { createCanvas, SKRSContext2D } from '@napi-rs/canvas';
import type { CrapsState } from '../games/craps.js';

const W = 320, H = 140;

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

function drawDie(ctx: SKRSContext2D, x: number, y: number, size: number, value: number) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
  const g = ctx.createLinearGradient(x, y, x, y + size);
  g.addColorStop(0, '#fafafa'); g.addColorStop(1, '#d4d4d4');
  ctx.fillStyle = g;
  roundRect(ctx, x, y, size, size, size * 0.14); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#a0a0a0'; ctx.lineWidth = 1;
  roundRect(ctx, x, y, size, size, size * 0.14); ctx.stroke();

  const pip = (dx: number, dy: number) => {
    ctx.beginPath();
    ctx.fillStyle = '#111';
    ctx.arc(x + dx, y + dy, size * 0.075, 0, Math.PI*2); ctx.fill();
  };
  const c = size/2, lo = size*0.25, hi = size*0.75;
  const P: Record<number, [number, number][]> = {
    1: [[c,c]],
    2: [[lo,lo],[hi,hi]],
    3: [[lo,lo],[c,c],[hi,hi]],
    4: [[lo,lo],[hi,lo],[lo,hi],[hi,hi]],
    5: [[lo,lo],[hi,lo],[c,c],[lo,hi],[hi,hi]],
    6: [[lo,lo],[hi,lo],[lo,c],[hi,c],[lo,hi],[hi,hi]],
  };
  for (const [px,py] of P[value] ?? []) pip(px, py);
}

export interface CrapsRenderInput {
  state: CrapsState;
}

export async function renderCraps(i: CrapsRenderInput): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Discord 暗背景のみ (フェルト撤去)
  ctx.fillStyle = '#2b2d31';
  ctx.fillRect(0, 0, W, H);

  const dieSize = 90;
  const cx = W/2;
  const cy = H/2;

  if (i.state.lastRoll) {
    // 2つのダイスを少し離して、わずかに角度違いで散らす
    ctx.save();
    ctx.translate(cx - dieSize/2 - 12, cy);
    ctx.rotate(-0.05);
    drawDie(ctx, -dieSize/2, -dieSize/2, dieSize, i.state.lastRoll[0]);
    ctx.restore();
    ctx.save();
    ctx.translate(cx + dieSize/2 + 12, cy);
    ctx.rotate(0.07);
    drawDie(ctx, -dieSize/2, -dieSize/2, dieSize, i.state.lastRoll[1]);
    ctx.restore();
  } else {
    ctx.fillStyle = '#6b7280'; ctx.font = 'italic 14px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('— まだ振られていません —', cx, cy);
  }

  return canvas.encode('png');
}
