// 各ゲームの画面を "テキスト + Application Emoji" 文字列で組み立てるフォーマッタ。
// Application Emoji の ID は src/ui/emoji-ids.ts に (アップロード後に) 生成される。
// 未アップロード時は emoji() が空文字を返すので、テキスト部分だけで表示が成立する。

import { emoji, EMOJI_IDS } from './emoji-ids.js';
import type { Card } from '../games/blackjack.js';
import type { Symbol as SlotSym } from '../games/slots.js';
import type { VPHand }  from '../games/videopoker.js';

const SUIT_NAME: Record<Card['suit'], string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const RANK_NAME = (r: Card['rank']): string => {
  if (r === 'A') return 'a';
  if (r === 'J') return 'j';
  if (r === 'Q') return 'q';
  if (r === 'K') return 'k';
  if (r === 'T') return '10';   // デッキ上の 10 は 'T'、絵文字名は card_*_10
  return String(r);
};

function cardEmoji(card: Card | 'back'): string {
  if (card === 'back') return emoji('card_back') || '🂠';
  const name = `card_${SUIT_NAME[card.suit]}_${RANK_NAME(card.rank)}`;
  // Fallback: emoji 未登録時は "A♠" 等のテキスト
  return emoji(name) || cardText(card);
}

/** ボタンに付けるカード絵文字。未登録なら null。 */
export function cardButtonEmoji(card: Card): { id: string; name: string } | null {
  const name = `card_${SUIT_NAME[card.suit]}_${RANK_NAME(card.rank)}`;
  const id = (EMOJI_IDS as Record<string, string>)[name];
  return id ? { id, name } : null;
}

export function cardText(card: Card): string {
  return `${rankLabel(card.rank)}${suitGlyph(card.suit)}`;
}
function rankLabel(r: Card['rank']) { return r === 'T' ? '10' : String(r); }
function suitGlyph(s: Card['suit']) { return ({S:'♠',H:'♥',D:'♦',C:'♣'})[s]; }

function row(cards: (Card | 'back')[]): string {
  return cards.map(cardEmoji).join(' ');
}

/** 絵文字だけの行を Discord の最大見出し (#) で大きく表示する。文字は混ぜないこと。 */
function big(emojis: string): string {
  return `# ${emojis}`;
}

// ========== BLACKJACK ==========
export interface FormatBJInput {
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

export function formatBlackjack(i: FormatBJInput): string {
  const lines: string[] = [];
  // Dealer
  const dealerCards: (Card | 'back')[] = i.hideHole && i.dealer.length >= 2
    ? [i.dealer[0], 'back', ...i.dealer.slice(2)]
    : i.dealer;
  lines.push(`**Dealer**`);
  lines.push(big(row(dealerCards)));
  lines.push('');
  // Player (split 対応)
  i.player.forEach((hand, idx) => {
    const marker = i.player.length > 1
      ? (idx === i.active && i.phase === 'player' ? '▶ ' : '　')
      : '';
    const label = i.player.length > 1 ? `**Hand ${idx + 1}** (bet ${i.bets[idx].toLocaleString()})` : `**You** (bet ${i.bets[idx].toLocaleString()})`;
    lines.push(`${marker}${label}`);
    lines.push(big(row(hand)));
    // 1 ハンドのときは共通の結果行だけで足りる。スプリット時だけ手ごとの勝敗を出す
    if (i.results?.[idx] && i.player.length > 1) {
      const res = i.results[idx];
      const resLabel = res === 'bj' ? '✨ BLACKJACK' : res === 'win' ? '✅ WIN' : res === 'push' ? '➖ PUSH' : '❌ LOSE';
      lines.push(`${marker}${resLabel}`);
    }
  });
  return lines.join('\n');
}

// ========== SLOTS ==========
export interface FormatSlotsInput {
  reels: SlotSym[];
  bet: number;
  payoutMult: number;
  spinning: boolean;
  label?: string;
}
const SLOT_EMOJI_NAME: Record<string, string> = {
  '🍒': 'slot_cherry',  '🍋': 'slot_lemon', '🍊': 'slot_orange',
  '🍉': 'slot_melon',   '⭐': 'slot_star',  '🔔': 'slot_bell',
  '💎': 'slot_diamond', '7️⃣': 'slot_seven',
};
function slotEmoji(s: SlotSym): string {
  const name = SLOT_EMOJI_NAME[s.id];
  return (name && emoji(name)) || s.id;
}
export function formatSlots(i: FormatSlotsInput): string {
  const lines: string[] = [];
  lines.push(big(`${slotEmoji(i.reels[0])} ${slotEmoji(i.reels[1])} ${slotEmoji(i.reels[2])}`));
  if (!i.spinning) {
    if (i.payoutMult > 0) lines.push(`**${i.payoutMult}x**${i.label ? `  ${i.label}` : ''}`);
  } else {
    lines.push('_spinning…_');
  }
  return lines.join('\n');
}

// ========== ROULETTE ==========
export interface FormatRouletteInput {
  resultNumber: number;
  spinning: boolean;
  betLabel: string;
  betAmount: number;
  payoutMult: number;    // 0 for lose
}
const RED_SET = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
function rouletteColor(n: number): 'red'|'black'|'green' {
  if (n === 0) return 'green';
  return RED_SET.has(n) ? 'red' : 'black';
}
export function formatRoulette(i: FormatRouletteInput): string {
  const chip = emoji(`rl_${i.resultNumber}`);
  const color = rouletteColor(i.resultNumber);
  const colorMark = color === 'red' ? '🟥' : color === 'black' ? '⬛' : '🟩';
  const num = chip || `${colorMark} ${i.resultNumber}`;
  const lines: string[] = [];
  if (i.spinning) {
    lines.push(`🎡 spinning…  bet: **${i.betLabel}**`);
  } else {
    lines.push(`Result  _(${color})_`);
    lines.push(big(num));
    lines.push(`bet: **${i.betLabel}**${i.payoutMult > 0 ? `  ×${i.payoutMult}` : ''}`);
  }
  return lines.join('\n');
}

// ========== BACCARAT ==========
export interface FormatBaccaratInput {
  player: Card[];
  banker: Card[];
  winner: 'player'|'banker'|'tie';
  playerTotal: number;
  bankerTotal: number;
  side: 'player'|'banker'|'tie';
  bet: number;
  payout: number;
}
export function formatBaccarat(i: FormatBaccaratInput): string {
  const winnerLabel = i.winner === 'tie' ? 'TIE' : i.winner === 'player' ? 'PLAYER WINS' : 'BANKER WINS';
  return [
    `**Player** (${i.playerTotal})`,
    big(row(i.player)),
    '',
    `**Banker** (${i.bankerTotal})`,
    big(row(i.banker)),
    '',
    `**${winnerLabel}**  (bet: ${i.side})`,
  ].join('\n');
}

// ========== VIDEO POKER ==========
export interface FormatVpInput {
  hand: VPHand;
  bet: number;
  phase: 'deal'|'drawn';
  rankLabel?: string;   // 役名
  payoutMult?: number;
}
export function formatVideoPoker(i: FormatVpInput): string {
  const cards = i.hand.cards.map(c => cardEmoji(c));
  const heldPos = i.hand.held.flatMap((h, idx) => h ? [`${idx + 1}`] : []);
  const lines: string[] = [
    big(cards.join(' ')),
  ];
  if (i.phase === 'deal') {
    lines.push(heldPos.length ? `HOLD 中: ${heldPos.join(', ')} 枚目  _(DRAW で引き直し)_` : '_HOLD を選んで DRAW_');
  }
  if (i.phase === 'drawn' && i.payoutMult && i.payoutMult > 0) lines.push(`×${i.payoutMult}`);
  return lines.join('\n');
}

// ========== CRAPS ==========
export interface FormatCrapsInput {
  dice: [number, number];
  total: number;
  phase: 'comeout'|'point';
  point?: number;
  log?: string[];
  betCount: number;
}
function diceEmoji(n: number): string {
  return emoji(`dice_${n}`) || (['','⚀','⚁','⚂','⚃','⚄','⚅'][n] ?? String(n));
}

/** 直近の出目を大きく表示する行。 */
export function crapsDiceLine(d1: number, d2: number): string {
  return big(`${diceEmoji(d1)} ${diceEmoji(d2)}`);
}
export function formatCraps(i: FormatCrapsInput): string {
  const lines: string[] = [];
  lines.push(crapsDiceLine(i.dice[0], i.dice[1]));
  lines.push(`= **${i.total}**`);
  lines.push(i.phase === 'comeout' ? '_(Come-out roll)_' : `_(Point: **${i.point}**)_`);
  if (i.log?.length) {
    lines.push('');
    lines.push('```');
    for (const l of i.log.slice(-5)) lines.push(l);
    lines.push('```');
  }
  lines.push(`Active bets: ${i.betCount}`);
  return lines.join('\n');
}
