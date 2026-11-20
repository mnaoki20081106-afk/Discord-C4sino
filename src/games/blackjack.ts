import { randomInt } from 'node:crypto';

export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K';
export interface Card { suit: Suit; rank: Rank; }

const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
const RANKS: Rank[] = ['A','2','3','4','5','6','7','8','9','T','J','Q','K'];

export function newShoe(decks = 6): Card[] {
  const shoe: Card[] = [];
  for (let d = 0; d < decks; d++)
    for (const s of SUITS) for (const r of RANKS) shoe.push({ suit: s, rank: r });
  // Fisher–Yates with crypto RNG
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

export function cardValue(c: Card): number {
  if (c.rank === 'A') return 11;
  if (['T','J','Q','K'].includes(c.rank)) return 10;
  return parseInt(c.rank, 10);
}

export function handTotal(hand: Card[]): { total: number; soft: boolean } {
  let total = 0, aces = 0;
  for (const c of hand) { total += cardValue(c); if (c.rank === 'A') aces++; }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  const soft = hand.some(c => c.rank === 'A') && hand.reduce((s,c)=>s+cardValue(c),0) === total;
  return { total, soft };
}

export const isBlackjack = (h: Card[]) => h.length === 2 && handTotal(h).total === 21;
export const isBust = (h: Card[]) => handTotal(h).total > 21;

export type Action = 'hit' | 'stand' | 'double' | 'split';

export interface BJState {
  shoe: Card[];
  player: Card[][];      // 分割対応
  dealer: Card[];
  bets: number[];        // 分割後の各ハンドのbet
  active: number;        // 現在プレイ中のハンド index
  phase: 'player' | 'dealer' | 'done';
  results?: ('win'|'lose'|'push'|'bj')[];
  payout?: number;       // 総払戻し (bet含む)
}

export function startHand(bet: number, shoe?: Card[]): BJState {
  const s = shoe ?? newShoe();
  const player = [[s.pop()!, s.pop()!]];
  const dealer = [s.pop()!, s.pop()!];
  return { shoe: s, player, dealer, bets: [bet], active: 0, phase: 'player' };
}

export function availableActions(st: BJState): Action[] {
  if (st.phase !== 'player') return [];
  const h = st.player[st.active];
  const acts: Action[] = ['hit', 'stand'];
  if (h.length === 2) {
    acts.push('double');
    if (h[0].rank === h[1].rank && st.player.length < 4) acts.push('split');
  }
  return acts;
}

export function apply(st: BJState, action: Action): BJState {
  if (st.phase !== 'player') return st;
  const h = st.player[st.active];
  if (action === 'hit') {
    h.push(st.shoe.pop()!);
    if (isBust(h) || handTotal(h).total === 21) nextHand(st);
  } else if (action === 'stand') {
    nextHand(st);
  } else if (action === 'double') {
    st.bets[st.active] *= 2;
    h.push(st.shoe.pop()!);
    nextHand(st);
  } else if (action === 'split') {
    const c2 = h.pop()!;
    st.player.splice(st.active + 1, 0, [c2, st.shoe.pop()!]);
    st.bets.splice(st.active + 1, 0, st.bets[st.active]);
    h.push(st.shoe.pop()!);
  }
  if ((st.phase as string) === 'dealer') settleDealer(st);
  return st;
}

function nextHand(st: BJState) {
  st.active++;
  if (st.active >= st.player.length) st.phase = 'dealer';
}

function settleDealer(st: BJState) {
  // ディーラーは16以下hit、ソフト17もhit (多くのルールで有利側=ハウス寄せる=Soft17 Hit)
  while (true) {
    const { total, soft } = handTotal(st.dealer);
    if (total < 17 || (total === 17 && soft)) st.dealer.push(st.shoe.pop()!);
    else break;
  }
  const dealerTotal = handTotal(st.dealer).total;
  const dealerBJ = isBlackjack(st.dealer);
  const results: ('win'|'lose'|'push'|'bj')[] = [];
  let payout = 0;
  st.player.forEach((h, i) => {
    const t = handTotal(h).total;
    const bj = isBlackjack(h) && st.player.length === 1;
    if (bj && !dealerBJ) { results.push('bj'); payout += Math.floor(st.bets[i] * 2.5); return; }
    if (bj && dealerBJ)  { results.push('push'); payout += st.bets[i]; return; }
    if (!bj && dealerBJ) { results.push('lose'); return; }
    if (t > 21) { results.push('lose'); return; }
    if (dealerTotal > 21 || t > dealerTotal) { results.push('win'); payout += st.bets[i] * 2; return; }
    if (t === dealerTotal) { results.push('push'); payout += st.bets[i]; return; }
    results.push('lose');
  });
  st.phase = 'done';
  st.results = results;
  st.payout = payout;
}
