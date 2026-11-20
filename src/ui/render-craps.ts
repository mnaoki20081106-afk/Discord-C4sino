import { createCanvas, SKRSContext2D } from '@napi-rs/canvas';
import type { CrapsState } from '../games/craps.js';

const W = 420, H = 260;

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

function drawDie(ctx: SKRSContext2D, x: number, y: number, size: number, value: number) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
  const g = ctx.createLinearGradient(x, y, x, y + size);
  g.addColorStop(0, '#f8f4ea'); g.addColorStop(1, '#d0c4a8');
  ctx.fillStyle = g;
  roundRect(ctx, x, y, size, size, size * 0.14); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#8a7a4a'; ctx.lineWidth = 1;
  roundRect(ctx, x, y, size, size, size * 0.14); ctx.stroke();

  const pip = (dx: number, dy: number) => {
    ctx.beginPath();
    ctx.fillStyle = '#5a1515';
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

  // 暗背景
  ctx.fillStyle = '#2b2d31';
  ctx.fillRect(0, 0, W, H);

  // 緑のフェルトのマット部分だけ (ダイス着地場所の演出)
  const matX = 40, matY = 30, matW = W - 80, matH = H - 60;
  const g = ctx.createRadialGradient(W/2, H/2, 20, W/2, H/2, 260);
  g.addColorStop(0, '#0d5a3a'); g.addColorStop(1, '#042416');
  ctx.fillStyle = g;
  roundRect(ctx, matX, matY, matW, matH, 12); ctx.fill();
  ctx.strokeStyle = '#c9a44a'; ctx.lineWidth = 2;
  roundRect(ctx, matX, matY, matW, matH, 12); ctx.stroke();

  const dieSize = 80;
  const cx = W/2;
  const cy = H/2 - 10;

  if (i.state.lastRoll) {
    drawDie(ctx, cx - dieSize - 15, cy - dieSize/2, dieSize, i.state.lastRoll[0]);
    drawDie(ctx, cx + 15,            cy - dieSize/2, dieSize, i.state.lastRoll[1]);
  } else {
    ctx.fillStyle = '#9ca3af'; ctx.font = 'italic 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('— まだ振られていません —', cx, cy);
  }

  return canvas.encode('png');
}
