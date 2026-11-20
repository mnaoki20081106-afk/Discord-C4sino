import { createCanvas, SKRSContext2D, GlobalFonts } from '@napi-rs/canvas';
import type { Card } from '../games/blackjack.js';
import { handTotal, isBlackjack } from '../games/blackjack.js';

const W = 900, H = 520;
const CARD_W = 90, CARD_H = 130, RADIUS = 10;

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

function drawCardFace(ctx: SKRSContext2D, c: Card, x: number, y: number) {
  // 白いカード
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#fafafa';
  roundRect(ctx, x, y, CARD_W, CARD_H, RADIUS);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = '#d0d0d0';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, CARD_W, CARD_H, RADIUS);
  ctx.stroke();

  ctx.fillStyle = SUIT_COLOR[c.suit];
  ctx.font = 'bold 22px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(c.rank === 'T' ? '10' : c.rank, x + 8, y + 6);
  ctx.font = '20px sans-serif';
  ctx.fillText(SUIT_GLYPH[c.suit], x + 8, y + 30);

  ctx.font = 'bold 44px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(SUIT_GLYPH[c.suit], x + CARD_W / 2, y + CARD_H / 2);
  ctx.textAlign = 'start';

  // 右下に反転表示
  ctx.save();
  ctx.translate(x + CARD_W - 8, y + CARD_H - 6);
  ctx.rotate(Math.PI);
  ctx.font = 'bold 22px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(c.rank === 'T' ? '10' : c.rank, 0, 0);
  ctx.font = '20px sans-serif';
  ctx.fillText(SUIT_GLYPH[c.suit], 0, 24);
  ctx.restore();
}

function drawCardBack(ctx: SKRSContext2D, x: number, y: number) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  const grad = ctx.createLinearGradient(x, y, x + CARD_W, y + CARD_H);
  grad.addColorStop(0, '#1e3a8a');
  grad.addColorStop(1, '#4c1d95');
  ctx.fillStyle = grad;
  roundRect(ctx, x, y, CARD_W, CARD_H, RADIUS);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 2;
  roundRect(ctx, x + 5, y + 5, CARD_W - 10, CARD_H - 10, RADIUS - 4);
  ctx.stroke();
  // ダイヤパターン
  ctx.fillStyle = 'rgba(251,191,36,0.4)';
  for (let r = 0; r < 6; r++) for (let cc = 0; cc < 4; cc++) {
    const cx = x + 15 + cc * 20, cy = y + 20 + r * 18;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 4); ctx.lineTo(cx + 4, cy); ctx.lineTo(cx, cy + 4); ctx.lineTo(cx - 4, cy);
    ctx.closePath(); ctx.fill();
  }
}

function drawHand(ctx: SKRSContext2D, cards: (Card | 'back')[], cx: number, cy: number) {
  const n = cards.length;
  const overlap = 35;
  const totalW = CARD_W + (n - 1) * overlap;
  const startX = cx - totalW / 2;
  for (let i = 0; i < n; i++) {
    const x = startX + i * overlap;
    const y = cy + Math.sin((i - (n - 1) / 2) * 0.15) * 4;
    const rot = (i - (n - 1) / 2) * 0.03;
    ctx.save();
    ctx.translate(x + CARD_W / 2, y + CARD_H / 2);
    ctx.rotate(rot);
    ctx.translate(-CARD_W / 2, -CARD_H / 2);
    if (cards[i] === 'back') drawCardBack(ctx, 0, 0);
    else drawCardFace(ctx, cards[i] as Card, 0, 0);
    ctx.restore();
  }
}

export interface RenderBJInput {
  player: Card[][];
  active: number;
  dealer: Card[];
  hideHole: boolean;        // ディーラーの2枚目を伏せる
  bets: number[];
  balance: number;
  phase: 'player'|'dealer'|'done';
  results?: ('win'|'lose'|'push'|'bj')[];
  payout?: number;
}

export async function renderBlackjack(i: RenderBJInput): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // フェルトテーブル (ラジアル)
  const g = ctx.createRadialGradient(W/2, H/2, 80, W/2, H/2, 600);
  g.addColorStop(0, '#0d5a3a');
  g.addColorStop(1, '#042416');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 金縁の半円アーチ
  ctx.strokeStyle = '#d4af37';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(W/2, H + 120, 500, Math.PI, 2*Math.PI);
  ctx.stroke();

  // タイトル
  ctx.fillStyle = 'rgba(212,175,55,0.9)';
  ctx.font = 'bold 22px serif';
  ctx.textAlign = 'center';
  ctx.fillText('BLACKJACK  —  pays 3 to 2', W/2, 40);
  ctx.font = '12px sans-serif';
  ctx.fillText('Dealer must stand on 17 and draw to 16', W/2, 58);
  ctx.textAlign = 'start';

  // ディーラー
  const dCards: (Card|'back')[] = i.hideHole && i.dealer.length >= 2
    ? [i.dealer[0], 'back', ...i.dealer.slice(2)]
    : i.dealer;
  drawHand(ctx, dCards, W/2, 90);
  const dTotal = i.hideHole ? null : handTotal(i.dealer).total;
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Dealer${dTotal!==null?` — ${dTotal}${isBlackjack(i.dealer)?' BJ':''}`:''}`, W/2, 240);

  // プレイヤー (最大4ハンド横並び)
  const handCount = i.player.length;
  const slotW = W / (handCount + 1);
  i.player.forEach((h, idx) => {
    const cx = slotW * (idx + 1);
    drawHand(ctx, h, cx, 300);
    const t = handTotal(h).total;
    const active = idx === i.active && i.phase === 'player';
    ctx.fillStyle = active ? '#fbbf24' : '#fff';
    ctx.font = `${active?'bold ':''}16px sans-serif`;
    ctx.fillText(`Hand ${idx+1}: ${t}`, cx, 450);
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#ddd';
    ctx.fillText(`bet ${i.bets[idx]}`, cx, 468);
    if (i.results?.[idx]) {
      const r = i.results[idx];
      const label = r==='win'?'WIN':r==='bj'?'BLACKJACK':r==='push'?'PUSH':'LOSE';
      const col = r==='lose'?'#ef4444':r==='push'?'#9ca3af':'#22c55e';
      ctx.fillStyle = col;
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(label, cx, 490);
    }
  });

  // バランス
  ctx.textAlign = 'left';
  ctx.fillStyle = '#d4af37';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText(`💰 ${i.balance.toLocaleString()} chips`, 20, H - 16);
  if (i.phase === 'done' && i.payout !== undefined) {
    ctx.textAlign = 'right';
    const net = i.payout - i.bets.reduce((a,b)=>a+b,0);
    ctx.fillStyle = net>0?'#22c55e':net<0?'#ef4444':'#9ca3af';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(`${net>=0?'+':''}${net} chips`, W-20, H-16);
  }

  return await canvas.encode('png');
}
