// シンプル版: カードを平らに横並び。回転・扇形なし。情報は Discord Embed に任せる。
import { createCanvas } from '@napi-rs/canvas';
import type { Card } from '../games/blackjack.js';
import { drawCardFace, drawCardBack, CARD_W, CARD_H } from './cards.js';

const W = 640, H = 380;
const GAP = 12;              // カード間のすき間
const DEALER_Y = 24;
const PLAYER_Y = 210;

export interface RenderBJInput {
  player: Card[][];
  active: number;
  dealer: Card[];
  hideHole: boolean;
  bets: number[];
  balance: number;
  phase: 'player'|'dealer'|'done';
  results?: ('win'|'lose'|'push'|'bj')[];
  payout?: number;
}

/** cards を中心 cx・上端 y から水平に並べる。回転なし・扇形なし。 */
function drawRow(ctx: any, cards: (Card | 'back')[], cx: number, y: number) {
  const n = cards.length;
  const totalW = n * CARD_W + (n - 1) * GAP;
  let x = cx - totalW / 2;
  for (const c of cards) {
    if (c === 'back') drawCardBack(ctx, x, y);
    else drawCardFace(ctx, c as Card, x, y);
    x += CARD_W + GAP;
  }
}

export async function renderBlackjack(i: RenderBJInput): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#2b2d31';          // Discord dark embed bg
  ctx.fillRect(0, 0, W, H);

  // ディーラー行
  const dealerCards: (Card | 'back')[] = i.hideHole && i.dealer.length >= 2
    ? [i.dealer[0], 'back', ...i.dealer.slice(2)]
    : i.dealer;
  drawRow(ctx, dealerCards, W / 2, DEALER_Y);

  // プレイヤー行 (スプリット時は横に並列)
  const handCount = i.player.length;
  const slotW = W / (handCount + 1);
  i.player.forEach((hand, idx) => {
    const cx = slotW * (idx + 1);
    drawRow(ctx, hand as (Card | 'back')[], cx, PLAYER_Y);
    // アクティブハンドに黄色いドット
    if (idx === i.active && i.phase === 'player' && handCount > 1) {
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath(); ctx.arc(cx, PLAYER_Y + CARD_H + 18, 6, 0, Math.PI * 2); ctx.fill();
    }
  });

  return canvas.encode('png');
}
