import { newShoe, type Card } from './blackjack.js';

// Baccarat ルール (Punto Banco)。
// 札値: A=1, 2-9=数字, T/J/Q/K=0。合計は 10 で割った余り (下一桁)。
// 第3枚ルール (標準):
//   Player: 合計 0-5 でドロー、6-7 でスタンド、8-9 はナチュラル
//   Banker:
//     Player が第3枚引かなかった場合: Banker 0-5 ドロー、6-7 スタンド
//     Player が第3枚引いた場合、Player 第3枚のランクに応じたテーブル
// 配当: Player 2.0, Banker 1.95 (5% コミ), Tie 9.0 (×8 プラス bet 返却)
// ハウスエッジ: Banker 1.06%, Player 1.24%, Tie 14.4%

export type Side = 'player' | 'banker' | 'tie';

export function cardPoint(c: Card): number {
  if (c.rank === 'A') return 1;
  if (['T','J','Q','K'].includes(c.rank)) return 0;
  return parseInt(c.rank, 10);
}

export const totalPoints = (hand: Card[]) =>
  hand.reduce((s, c) => s + cardPoint(c), 0) % 10;

export interface BaccaratResult {
  player: Card[];
  banker: Card[];
  playerTotal: number;
  bankerTotal: number;
  winner: Side;
}

/** 1 回のシュー消費でハンドを決着させる。 */
export function dealBaccarat(shoe?: Card[]): BaccaratResult {
  const s = shoe ?? newShoe();
  const player: Card[] = [s.pop()!, s.pop()!];
  const banker: Card[] = [s.pop()!, s.pop()!];
  let pt = totalPoints(player), bt = totalPoints(banker);

  // ナチュラル (8-9) チェック
  if (pt >= 8 || bt >= 8) {
    return decide(player, banker, pt, bt);
  }

  // Player 第3枚
  let playerThird: Card | null = null;
  if (pt <= 5) {
    playerThird = s.pop()!;
    player.push(playerThird);
    pt = totalPoints(player);
  }

  // Banker 第3枚 (ルールテーブル)
  let bankerDraw = false;
  if (playerThird === null) {
    // Player stood → Banker 0-5 draw, 6-7 stand
    if (bt <= 5) bankerDraw = true;
  } else {
    const p3 = cardPoint(playerThird);
    switch (bt) {
      case 0: case 1: case 2: bankerDraw = true; break;
      case 3: bankerDraw = p3 !== 8; break;
      case 4: bankerDraw = p3 >= 2 && p3 <= 7; break;
      case 5: bankerDraw = p3 >= 4 && p3 <= 7; break;
      case 6: bankerDraw = p3 >= 6 && p3 <= 7; break;
      default: bankerDraw = false; // 7 以上はスタンド
    }
  }
  if (bankerDraw) { banker.push(s.pop()!); bt = totalPoints(banker); }

  return decide(player, banker, pt, bt);
}

function decide(player: Card[], banker: Card[], pt: number, bt: number): BaccaratResult {
  const winner: Side = pt > bt ? 'player' : pt < bt ? 'banker' : 'tie';
  return { player, banker, playerTotal: pt, bankerTotal: bt, winner };
}

/** 掛けに対する gross payout 倍率 (bet 含む)。負けは 0。 */
export function payoutMult(side: Side, winner: Side): number {
  if (side === winner) {
    if (side === 'player') return 2;
    if (side === 'banker') return 1.95;   // 5% コミ
    if (side === 'tie')    return 9;      // 8:1 + bet 返却
  }
  // Tie のときに Player/Banker ベットは bet が返却 (push) — 一般的ルール
  if (winner === 'tie' && (side === 'player' || side === 'banker')) return 1;
  return 0;
}
