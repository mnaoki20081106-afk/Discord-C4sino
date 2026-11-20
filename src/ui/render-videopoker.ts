import { createCanvas } from '@napi-rs/canvas';
import type { Card } from '../games/blackjack.js';
import { drawCardFace, CARD_W, CARD_H } from './cards.js';
import { L } from './leet.js';
import { PAY } from '../games/videopoker.js';

const W = 820, H = 500;

export interface VPRenderInput {
  cards: Card[];        // 5 枚
  held: boolean[];
  phase: 'deal' | 'drawn';
  rank?: keyof typeof PAY;
  bet: number;
  balance: number;
  payoutMult: number;
  label?: string;
}

const HAND_LABEL: Record<string, string> = {
  royal_flush:     'ROYAL FLUSH',
  straight_flush:  'STRAIGHT FLUSH',
  four_of_a_kind:  'FOUR OF A KIND',
  full_house:      'FULL HOUSE',
  flush:           'FLUSH',
  straight:        'STRAIGHT',
  three_of_a_kind: 'THREE OF A KIND',
  two_pair:        'TWO PAIR',
  jacks_or_better: 'JACKS OR BETTER',
  nothing:         'NOTHING',
};

export function renderVideoPoker(i: VPRenderInput): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // 背景 (紫系 — カジノの電飾イメージ)
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#2d0a4e'); g.addColorStop(1, '#0d0320');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // タイトル
  ctx.fillStyle = '#ffd93d'; ctx.font = 'bold 24px serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${L('VIDEO')} ${L('POKER')}  —  ${L('JACKS OR BETTER')}`, W/2, 40);

  // 配当表
  ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#ffd93d';
  const payList = Object.entries(PAY).filter(([,v]) => v > 0).sort((a,b) => b[1] - a[1]);
  const highlight = i.rank && i.rank !== 'nothing' ? i.rank : null;
  let y0 = 70;
  for (const [k, v] of payList) {
    ctx.fillStyle = k === highlight ? '#22c55e' : '#ffd93d';
    ctx.font = k === highlight ? 'bold 13px sans-serif' : '12px sans-serif';
    ctx.fillText(`${HAND_LABEL[k].padEnd(18)}  ×${v}`, 30, y0);
    y0 += 16;
  }

  // カード
  const gap = 16;
  const startX = 240;
  const cy = 170;
  for (let k = 0; k < 5; k++) {
    const x = startX + k * (CARD_W + gap);
    drawCardFace(ctx, i.cards[k], x, cy);
    // HELD 表示
    if (i.held[k]) {
      ctx.fillStyle = '#ffd93d';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#ff8800'; ctx.shadowBlur = 8;
      ctx.fillText('HELD', x + CARD_W/2, cy + CARD_H + 20);
      ctx.shadowBlur = 0;
    }
  }

  // 結果表示
  if (i.phase === 'drawn' && i.rank) {
    const win = Math.floor(i.bet * i.payoutMult);
    const isWin = win > 0;
    ctx.textAlign = 'center';
    ctx.fillStyle = isWin ? '#22c55e' : '#9ca3af';
    ctx.font = 'bold 22px serif';
    if (isWin) ctx.shadowColor = '#22c55e', ctx.shadowBlur = 15;
    ctx.fillText(HAND_LABEL[i.rank], W/2, 370);
    ctx.shadowBlur = 0;
    if (isWin) {
      ctx.font = 'bold 18px sans-serif';
      ctx.fillStyle = '#22c55e';
      ctx.fillText(`${i.label ?? L('WIN')}  +${(win - i.bet).toLocaleString()}`, W/2, 400);
    } else {
      ctx.font = '16px sans-serif'; ctx.fillStyle = '#9ca3af';
      ctx.fillText(L('NO WIN'), W/2, 400);
    }
  } else {
    ctx.textAlign = 'center'; ctx.fillStyle = '#ffd93d';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('HOLD したいカードのボタンを押して [DRAW] で引き直し', W/2, 370);
  }

  // Bet / Balance
  ctx.textAlign = 'left'; ctx.fillStyle = '#ffd93d';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText(`${L('BET')}: ${i.bet.toLocaleString()} ${L('chips')}`, 30, H - 20);
  ctx.textAlign = 'right';
  ctx.fillText(`💰 ${i.balance.toLocaleString()} ${L('chips')}`, W - 30, H - 20);

  return canvas.encode('png');
}
