import { newShoe, type Card } from './blackjack.js';

// Jacks or Better (9/6) — RTP ≈ 99.54%。配当倍率は gross (bet 含む)。
export const PAY: Record<string, number> = {
  royal_flush:     800,
  straight_flush:   50,
  four_of_a_kind:   25,
  full_house:        9,
  flush:             6,
  straight:          4,
  three_of_a_kind:   3,
  two_pair:          2,
  jacks_or_better:   1,
  nothing:           0,
};

export type VPHand = {
  shoe: Card[];
  cards: Card[];      // 5 枚
  held: boolean[];    // held[i] = true なら draw で保持
  phase: 'deal' | 'drawn';
  rank?: keyof typeof PAY;
};

const RANK_ORDER: Record<string, number> = {
  A:14, '2':2, '3':3, '4':4, '5':5, '6':6, '7':7, '8':8, '9':9, T:10, J:11, Q:12, K:13,
};

export function evaluate(cards: Card[]): keyof typeof PAY {
  const ranks = cards.map(c => RANK_ORDER[c.rank]).sort((a,b)=>a-b);
  const suits = cards.map(c => c.suit);
  const flush = suits.every(s => s === suits[0]);
  // straight: 連続 or A-2-3-4-5
  const uniq = [...new Set(ranks)];
  let straight = false;
  if (uniq.length === 5) {
    if (ranks[4] - ranks[0] === 4) straight = true;
    if (JSON.stringify(ranks) === JSON.stringify([2,3,4,5,14])) straight = true;
  }
  const royal = straight && flush && ranks[0] === 10 && ranks[4] === 14;

  // 同じランクの集計
  const counts: Record<number, number> = {};
  for (const r of ranks) counts[r] = (counts[r] ?? 0) + 1;
  const countVals = Object.values(counts).sort((a,b)=>b-a);
  const pairs = Object.entries(counts).filter(([,c]) => c === 2);

  if (royal) return 'royal_flush';
  if (straight && flush) return 'straight_flush';
  if (countVals[0] === 4) return 'four_of_a_kind';
  if (countVals[0] === 3 && countVals[1] === 2) return 'full_house';
  if (flush) return 'flush';
  if (straight) return 'straight';
  if (countVals[0] === 3) return 'three_of_a_kind';
  if (pairs.length === 2) return 'two_pair';
  // Jacks or Better: J/Q/K/A のペア
  if (pairs.length === 1) {
    const r = parseInt(pairs[0][0], 10);
    if (r >= 11 || r === 14) return 'jacks_or_better';
  }
  return 'nothing';
}

export function startVP(shoe?: Card[]): VPHand {
  const s = shoe ?? newShoe();
  const cards = Array.from({ length: 5 }, () => s.pop()!);
  return { shoe: s, cards, held: [false,false,false,false,false], phase: 'deal' };
}

export function drawVP(hand: VPHand): VPHand {
  if (hand.phase !== 'deal') return hand;
  for (let i = 0; i < 5; i++) {
    if (!hand.held[i]) hand.cards[i] = hand.shoe.pop()!;
  }
  hand.phase = 'drawn';
  hand.rank = evaluate(hand.cards);
  return hand;
}

export function payoutFor(rank: keyof typeof PAY): number {
  return PAY[rank] ?? 0;
}
