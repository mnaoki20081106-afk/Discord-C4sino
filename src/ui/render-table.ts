// シンプル版: カードだけ描画、情報は Discord Embed のフィールドに任せる
import { createCanvas } from '@napi-rs/canvas';
import type { Card } from '../games/blackjack.js';
import { drawCardFace, drawCardBack, CARD_W, CARD_H } from './cards.js';

const W = 640, H = 420;

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

/** 扇状にカードを置く */
function placeFanned(cards: (Card | 'back')[], cx: number, cy: number, _spread = 1) {
  const n = cards.length;
  const overlap = 36;
  const totalW = CARD_W + (n - 1) * overlap;
  const startX = cx - totalW / 2;
  return cards.map((c, i) => ({
    c,
    x: startX + i * overlap,
    y: cy + Math.sin((i - (n - 1) / 2) * 0.12) * 4,
    rot: (i - (n - 1) / 2) * 0.03,
  }));
}

export async function renderBlackjack(i: RenderBJInput): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // 透過感のある暗背景
  ctx.fillStyle = '#2b2d31';          // Discord dark embed bg
  ctx.fillRect(0, 0, W, H);

  // 上: ディーラー
  const dealerCards: (Card | 'back')[] = i.hideHole && i.dealer.length >= 2
    ? [i.dealer[0], 'back', ...i.dealer.slice(2)]
    : i.dealer;
  for (const p of placeFanned(dealerCards, W/2, 20)) {
    ctx.save();
    ctx.translate(p.x + CARD_W/2, p.y + CARD_H/2);
    ctx.rotate(p.rot);
    ctx.translate(-CARD_W/2, -CARD_H/2);
    if (p.c === 'back') drawCardBack(ctx, 0, 0);
    else drawCardFace(ctx, p.c as Card, 0, 0);
    ctx.restore();
  }

  // 下: プレイヤー (ハンド 1 つなら中央、分割時は横並び)
  const handCount = i.player.length;
  const slotW = W / (handCount + 1);
  i.player.forEach((hand, idx) => {
    const cx = slotW * (idx + 1);
    const cards = hand as (Card | 'back')[];
    for (const p of placeFanned(cards, cx, 240)) {
      ctx.save();
      ctx.translate(p.x + CARD_W/2, p.y + CARD_H/2);
      ctx.rotate(p.rot);
      ctx.translate(-CARD_W/2, -CARD_H/2);
      if (p.c === 'back') drawCardBack(ctx, 0, 0);
      else drawCardFace(ctx, p.c as Card, 0, 0);
      ctx.restore();
    }
    // アクティブハンドの下に黄色いピン
    if (idx === i.active && i.phase === 'player' && handCount > 1) {
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath(); ctx.arc(cx, 395, 6, 0, Math.PI*2); ctx.fill();
    }
  });

  return canvas.encode('png');
}
