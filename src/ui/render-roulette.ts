import { createCanvas, SKRSContext2D } from '@napi-rs/canvas';
import { WHEEL, color as colorOf } from '../games/roulette.js';
import { L } from './leet.js';

const W = 720, H = 520;

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

export interface RouletteRenderInput {
  betLabel: string;
  betAmount: number;
  balance: number;
  resultNumber: number;       // 0..36 (結果or途中値)
  ballAngle: number;          // ラジアン: ボールの現在位置 (0 = 真上)
  spinning: boolean;          // true=回転中 / false=停止
  payoutMult: number;          // 停止後の倍率 (0..) — gross
  label?: string;
}

export function renderRoulette(i: RouletteRenderInput): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // 背景
  const bg = ctx.createRadialGradient(W/2, H/2, 80, W/2, H/2, 600);
  bg.addColorStop(0, '#0d5a3a'); bg.addColorStop(1, '#042416');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // ホイール
  const cx = W/2, cy = 240, R = 180, rInner = 110;
  const n = WHEEL.length; // 37
  const seg = (Math.PI * 2) / n;

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
    ctx.strokeStyle = '#222'; ctx.lineWidth = 0.8; ctx.stroke();

    // 数字
    const am = (a0 + a1)/2;
    const tx = cx + Math.cos(am) * (R - 24);
    const ty = cy + Math.sin(am) * (R - 24);
    ctx.save();
    ctx.translate(tx, ty); ctx.rotate(am + Math.PI/2);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(num), 0, 0);
    ctx.restore();
  }

  // 中央ハブ (ゴールド)
  const hub = ctx.createRadialGradient(cx-10, cy-10, 5, cx, cy, rInner);
  hub.addColorStop(0, '#f6c84c'); hub.addColorStop(1, '#8a6b1a');
  ctx.fillStyle = hub;
  ctx.beginPath(); ctx.arc(cx, cy, rInner, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#4a3610'; ctx.lineWidth = 3; ctx.stroke();

  // "C4sino" 中央刻印
  ctx.fillStyle = '#4a3610';
  ctx.font = 'bold 20px serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('C4SINO', cx, cy - 10);
  ctx.font = '10px serif';
  ctx.fillText('ROULETTE', cx, cy + 10);

  // ボール (回転ないし停止時の最終位置)
  const ballR = R - 6;
  const bx = cx + Math.cos(i.ballAngle - Math.PI/2) * ballR;
  const by = cy + Math.sin(i.ballAngle - Math.PI/2) * ballR;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
  const bg2 = ctx.createRadialGradient(bx-3, by-3, 1, bx, by, 8);
  bg2.addColorStop(0, '#fff'); bg2.addColorStop(1, '#a0a0a0');
  ctx.fillStyle = bg2;
  ctx.beginPath(); ctx.arc(bx, by, 7, 0, Math.PI*2); ctx.fill();
  ctx.restore();

  // 結果パネル
  const panelY = 450, panelH = 50;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundRect(ctx, 20, panelY, W-40, panelH, 10); ctx.fill();
  ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 1.5; roundRect(ctx, 20, panelY, W-40, panelH, 10); ctx.stroke();

  ctx.fillStyle = '#d4af37';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText(`${L('BET')}: ${i.betLabel}  —  ${i.betAmount.toLocaleString()} ${L('chips')}`, 32, panelY + panelH/2);

  ctx.textAlign = 'right';
  if (i.spinning) {
    ctx.fillStyle = '#fff';
    ctx.fillText(`${L('SPINNING')}…`, W - 32, panelY + panelH/2);
  } else {
    const win = i.betAmount * i.payoutMult;
    const col = colorOf(i.resultNumber);
    const colLabel = col === 'red' ? '🟥' : col === 'black' ? '⬛' : '🟩';
    const txt = `${colLabel} ${i.resultNumber}  —  ` +
      (win > 0 ? `${i.label ?? L('WIN')} +${(win - i.betAmount).toLocaleString()}` : L('LOSE'));
    ctx.fillStyle = win > 0 ? '#22c55e' : '#ef4444';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(txt, W - 32, panelY + panelH/2);
  }

  // 下部: バランス
  ctx.textAlign = 'left'; ctx.fillStyle = '#d4af37'; ctx.font = 'bold 12px sans-serif';
  ctx.fillText(`💰 ${i.balance.toLocaleString()} ${L('chips')}`, 20, H - 12);

  return canvas.encode('png');
}
