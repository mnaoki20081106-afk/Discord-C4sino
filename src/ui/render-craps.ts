import { createCanvas, SKRSContext2D } from '@napi-rs/canvas';
import type { CrapsState, CrapsBetKind } from '../games/craps.js';
import { L } from './leet.js';

const W = 900, H = 560;

const KIND_LABEL: Record<CrapsBetKind, string> = {
  pass: 'Pass', dontpass: "Don't Pass", pass_odds: 'Pass Odds', dontpass_odds: "Don't Pass Odds",
  come: 'Come', dontcome: "Don't Come",
  field: 'Field',
  place4:'Place 4', place5:'Place 5', place6:'Place 6',
  place8:'Place 8', place9:'Place 9', place10:'Place 10',
  hard4:'Hard 4', hard6:'Hard 6', hard8:'Hard 8', hard10:'Hard 10',
  big6:'Big 6', big8:'Big 8',
  any7:'Any 7', anycraps:'Any Craps',
  yo11:'Yo (11)', snakeeyes:'Snake Eyes (2)', acedeuce:'Ace-Deuce (3)', boxcars:'Boxcars (12)',
};

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

function drawDie(ctx: SKRSContext2D, x: number, y: number, size: number, value: number) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#fafafa';
  roundRect(ctx, x, y, size, size, size * 0.14);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#d0d0d0'; ctx.lineWidth = 1;
  roundRect(ctx, x, y, size, size, size * 0.14); ctx.stroke();

  const pip = (dx: number, dy: number) => {
    ctx.beginPath();
    ctx.fillStyle = '#111';
    ctx.arc(x + dx, y + dy, size * 0.07, 0, Math.PI*2); ctx.fill();
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
  balance: number;
  lastReport?: { d1: number; d2: number; log: string };
}

export function renderCraps(i: CrapsRenderInput): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // フェルト背景
  const g = ctx.createRadialGradient(W/2, H/2, 80, W/2, H/2, 700);
  g.addColorStop(0, '#0d5a3a'); g.addColorStop(1, '#042416');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // タイトル + フェーズ
  ctx.fillStyle = '#d4af37'; ctx.font = 'bold 24px serif';
  ctx.textAlign = 'center';
  ctx.fillText(L('CRAPS'), W/2, 36);
  ctx.font = 'bold 14px sans-serif';
  const phaseText = i.state.phase === 'comeout'
    ? `${L('COME')} ${L('OUT')} — 7 or 11 で勝ち / 2-3-12 でクラップス`
    : `POINT ${i.state.point}  —  ${i.state.point} 再出目で Pass, 7 で Seven-Out`;
  ctx.fillStyle = '#fff';
  ctx.fillText(phaseText, W/2, 58);

  // ダイス
  const dieSize = 80;
  const cx = W/2, cy = 140;
  if (i.state.lastRoll) {
    drawDie(ctx, cx - dieSize - 15, cy, dieSize, i.state.lastRoll[0]);
    drawDie(ctx, cx + 15,            cy, dieSize, i.state.lastRoll[1]);
    ctx.fillStyle = '#d4af37'; ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`= ${i.state.lastRoll[0] + i.state.lastRoll[1]}`, cx, cy + dieSize + 28);
  } else {
    ctx.fillStyle = '#aaa'; ctx.font = 'italic 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('— まだ振られていません —', cx, cy + 40);
  }

  // POINT パック (ON/OFF)
  const pointBoxX = 60, pointBoxY = 110, pbSize = 80;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  roundRect(ctx, pointBoxX, pointBoxY, pbSize, pbSize, 8); ctx.fill();
  ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 2;
  roundRect(ctx, pointBoxX, pointBoxY, pbSize, pbSize, 8); ctx.stroke();
  ctx.fillStyle = '#d4af37'; ctx.textAlign = 'center';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText('POINT', pointBoxX + pbSize/2, pointBoxY + 20);
  ctx.font = 'bold 36px serif';
  ctx.fillText(i.state.point ? String(i.state.point) : 'OFF', pointBoxX + pbSize/2, pointBoxY + pbSize/2 + 10);

  // ベット一覧
  const betX = 60, betY = 260, betW = W - 120;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  roundRect(ctx, betX, betY, betW, 180, 10); ctx.fill();
  ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 1;
  roundRect(ctx, betX, betY, betW, 180, 10); ctx.stroke();

  ctx.fillStyle = '#d4af37'; ctx.textAlign = 'left';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText(`アクティブなベット (${i.state.bets.length})`, betX + 14, betY + 22);

  ctx.font = '13px sans-serif'; ctx.fillStyle = '#fff';
  const perRow = 2;
  const colW = (betW - 28) / perRow;
  const rowH = 20;
  let col = 0, row = 0;
  for (const b of i.state.bets.slice(0, 14)) {
    const px = betX + 14 + col * colW;
    const py = betY + 44 + row * rowH;
    const label = KIND_LABEL[b.kind] + (b.point ? ` → ${b.point}` : '');
    ctx.fillText(`#${b.id} ${label}  ${b.amount.toLocaleString()}`, px, py);
    col++;
    if (col >= perRow) { col = 0; row++; }
  }
  if (i.state.bets.length > 14) {
    ctx.fillStyle = '#aaa';
    ctx.fillText(`…他 ${i.state.bets.length - 14} 件`, betX + 14, betY + 44 + (row+1) * rowH);
  }
  if (!i.state.bets.length) {
    ctx.fillStyle = '#aaa'; ctx.font = 'italic 14px sans-serif';
    ctx.fillText('ベットを置いて ROLL を押してください。', betX + 14, betY + 60);
  }

  // 履歴 (直近 3)
  const histY = 450;
  ctx.fillStyle = '#d4af37'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('直近の振り:', 60, histY + 14);
  ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif';
  const recent = i.state.history.slice(-3);
  for (let k = 0; k < recent.length; k++) {
    ctx.fillText(recent[k], 60, histY + 30 + k * 16);
  }

  // Bet / Balance
  ctx.textAlign = 'left'; ctx.fillStyle = '#d4af37'; ctx.font = 'bold 14px sans-serif';
  ctx.fillText(`💰 ${i.balance.toLocaleString()} ${L('chips')}`, 30, H - 16);
  ctx.textAlign = 'right';
  const net = i.state.totalReturned - i.state.totalWagered;
  const netColor = net > 0 ? '#22c55e' : net < 0 ? '#ef4444' : '#aaa';
  ctx.fillStyle = netColor;
  ctx.fillText(`累計 ${net>=0?'+':''}${net.toLocaleString()}  (賭 ${i.state.totalWagered.toLocaleString()} / 戻 ${i.state.totalReturned.toLocaleString()})`, W - 30, H - 16);

  return canvas.encode('png');
}
