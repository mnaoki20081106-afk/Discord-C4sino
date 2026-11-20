import { createCanvas } from '@napi-rs/canvas';
import type { Card } from '../games/blackjack.js';
import type { Side } from '../games/baccarat.js';
import { drawCardFace, CARD_W } from './cards.js';
import { L } from './leet.js';

const W = 820, H = 460;

export interface BacRenderInput {
  player: Card[];
  banker: Card[];
  playerTotal: number;
  bankerTotal: number;
  winner: Side | null;        // null = 未確定 (アニメ途中)
  side: Side;                  // ユーザーのベット先
  betAmount: number;
  balance: number;
  payoutMult: number;
  label?: string;
}

export function renderBaccarat(i: BacRenderInput): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // フェルト背景
  const g = ctx.createRadialGradient(W/2, H/2, 80, W/2, H/2, 700);
  g.addColorStop(0, '#0d5a3a'); g.addColorStop(1, '#042416');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // タイトル
  ctx.fillStyle = '#d4af37'; ctx.font = 'bold 20px serif';
  ctx.textAlign = 'center'; ctx.fillText(L('BACCARAT'), W/2, 34);

  // プレイヤー / バンカー ラベル
  const labelY = 70;
  ctx.font = 'bold 16px sans-serif';
  ctx.fillStyle = i.winner === 'player' ? '#22c55e' : '#fff';
  ctx.fillText(`${L('PLAYER')}  —  ${i.playerTotal}`, W/4, labelY);
  ctx.fillStyle = i.winner === 'banker' ? '#22c55e' : '#fff';
  ctx.fillText(`${L('BANKER')}  —  ${i.bankerTotal}`, (3*W)/4, labelY);

  // カード配置
  const drawHand = (cards: Card[], cx: number, cy: number) => {
    const n = cards.length;
    const gap = 16;
    const totalW = CARD_W * n + gap * (n - 1);
    const startX = cx - totalW/2;
    for (let k = 0; k < n; k++) {
      drawCardFace(ctx, cards[k], startX + k*(CARD_W+gap), cy);
    }
  };
  drawHand(i.player, W/4, 90);
  drawHand(i.banker, (3*W)/4, 90);

  // 結果パネル
  if (i.winner) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(40, 260, W - 80, 60);
    ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 2; ctx.strokeRect(40, 260, W - 80, 60);

    const winTxt =
      i.winner === 'tie' ? `${L('TIE')}` :
      i.winner === 'player' ? `${L('PLAYER')} ${L('WINS')}` :
      `${L('BANKER')} ${L('WINS')}`;
    ctx.fillStyle = '#d4af37';
    ctx.font = 'bold 24px serif'; ctx.textAlign = 'center';
    ctx.fillText(winTxt, W/2, 298);

    const win = Math.floor(i.betAmount * i.payoutMult);
    const net = win - i.betAmount;
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = net > 0 ? '#22c55e' : net < 0 ? '#ef4444' : '#9ca3af';
    const msg = net > 0 ? `${i.label ?? L('WIN')}  +${net.toLocaleString()}` : net === 0 ? `${L('PUSH')}` : `${L('LOSE')}  ${net.toLocaleString()}`;
    ctx.fillText(msg, W/2, 335);
  }

  // Bet / Balance
  ctx.textAlign = 'left'; ctx.fillStyle = '#d4af37';
  ctx.font = 'bold 14px sans-serif';
  const sideLabel = i.side === 'player' ? L('PLAYER') : i.side === 'banker' ? L('BANKER') : L('TIE');
  ctx.fillText(`${L('BET')}: ${sideLabel}  —  ${i.betAmount.toLocaleString()} ${L('chips')}`, 24, H - 36);
  ctx.textAlign = 'right';
  ctx.fillText(`💰 ${i.balance.toLocaleString()} ${L('chips')}`, W - 24, H - 36);

  return canvas.encode('png');
}
