import { createCanvas } from '@napi-rs/canvas';
import { WHEEL, color as colorOf } from '../games/roulette.js';

const W = 480, H = 480;

export interface RouletteRenderInput {
  resultNumber: number;
  ballAngle: number;
  spinning: boolean;
}

export function renderRoulette(i: RouletteRenderInput): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // 背景 (暗)
  ctx.fillStyle = '#2b2d31';
  ctx.fillRect(0, 0, W, H);

  const cx = W/2, cy = H/2;
  const R = 220, rInner = 130;
  const n = WHEEL.length;
  const seg = (Math.PI * 2) / n;

  // 木目調の外周リング
  ctx.fillStyle = '#3d1f0a';
  ctx.beginPath(); ctx.arc(cx, cy, R + 14, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#c9a44a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, R + 14, 0, Math.PI*2); ctx.stroke();

  // セクタ
  for (let k = 0; k < n; k++) {
    const num = WHEEL[k];
    const a0 = -Math.PI/2 + k * seg - seg/2;
    const a1 = a0 + seg;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, a0, a1);
    ctx.closePath();
    const c = colorOf(num);
    ctx.fillStyle = c === 'red' ? '#c62828' : c === 'black' ? '#111' : '#0d8a3a';
    ctx.fill();
    ctx.strokeStyle = '#2a1a0a'; ctx.lineWidth = 0.8; ctx.stroke();

    // 数字
    const am = (a0 + a1)/2;
    const tx = cx + Math.cos(am) * (R - 28);
    const ty = cy + Math.sin(am) * (R - 28);
    ctx.save();
    ctx.translate(tx, ty); ctx.rotate(am + Math.PI/2);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(num), 0, 0);
    ctx.restore();
  }

  // 中央ハブ (ゴールド)
  const hub = ctx.createRadialGradient(cx-12, cy-12, 6, cx, cy, rInner);
  hub.addColorStop(0, '#f6d87c');
  hub.addColorStop(0.6, '#b8862a');
  hub.addColorStop(1, '#5a3a0a');
  ctx.fillStyle = hub;
  ctx.beginPath(); ctx.arc(cx, cy, rInner, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#2a1a0a'; ctx.lineWidth = 2; ctx.stroke();

  // 中央 スポーク
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 2;
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 20, cy + Math.sin(a) * 20);
    ctx.lineTo(cx + Math.cos(a) * (rInner - 6), cy + Math.sin(a) * (rInner - 6));
    ctx.stroke();
  }

  // 中央エンブレム
  ctx.fillStyle = '#0a0a1a';
  ctx.beginPath(); ctx.arc(cx, cy, 20, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#c9a44a';
  ctx.font = 'bold 14px serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('C', cx, cy);

  // ボール
  const ballR = R - 6;
  const bx = cx + Math.cos(i.ballAngle - Math.PI/2) * ballR;
  const by = cy + Math.sin(i.ballAngle - Math.PI/2) * ballR;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
  const bgrad = ctx.createRadialGradient(bx-3, by-3, 1, bx, by, 9);
  bgrad.addColorStop(0, '#fff'); bgrad.addColorStop(1, '#8a8a8a');
  ctx.fillStyle = bgrad;
  ctx.beginPath(); ctx.arc(bx, by, 8, 0, Math.PI*2); ctx.fill();
  ctx.restore();

  // 勝利時: 結果番号をハイライト
  if (!i.spinning) {
    const idx = WHEEL.indexOf(i.resultNumber);
    const a0 = -Math.PI/2 + idx * seg - seg/2;
    const a1 = a0 + seg;
    ctx.strokeStyle = '#f6d87c';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R);
    ctx.arc(cx, cy, R, a0, a1);
    ctx.lineTo(cx + Math.cos(a1) * (R - 50), cy + Math.sin(a1) * (R - 50));
    ctx.arc(cx, cy, R - 50, a1, a0, true);
    ctx.closePath();
    ctx.stroke();
  }

  return canvas.encode('png');
}
