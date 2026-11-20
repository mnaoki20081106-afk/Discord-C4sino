import { randomInt } from 'node:crypto';

// European single-zero (0-36)。ハウスエッジ 2.7%。
const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

export type BetKind =
  | 'red' | 'black'
  | 'odd' | 'even'
  | 'low' | 'high'
  | 'dozen1' | 'dozen2' | 'dozen3'
  | 'column1' | 'column2' | 'column3'
  | 'number';

export interface RouletteBet {
  kind: BetKind;
  amount: number;
  number?: number;    // kind='number' のときのみ (0..36)
}

export function spinRoulette(): number { return randomInt(0, 37); }

export const isRed   = (n: number) => RED.has(n);
export const isBlack = (n: number) => n > 0 && !RED.has(n);
export const color   = (n: number) => n === 0 ? 'green' : (isRed(n) ? 'red' : 'black');

/** 当選時の配当倍率 (bet 含む gross)。負けなら 0。 */
export function payoutMult(bet: RouletteBet, result: number): number {
  switch (bet.kind) {
    case 'red':     return isRed(result)                                   ? 2  : 0;
    case 'black':   return isBlack(result)                                 ? 2  : 0;
    case 'odd':     return result > 0 && result % 2 === 1                  ? 2  : 0;
    case 'even':    return result > 0 && result % 2 === 0                  ? 2  : 0;
    case 'low':     return result >= 1  && result <= 18                    ? 2  : 0;
    case 'high':    return result >= 19 && result <= 36                    ? 2  : 0;
    case 'dozen1':  return result >= 1  && result <= 12                    ? 3  : 0;
    case 'dozen2':  return result >= 13 && result <= 24                    ? 3  : 0;
    case 'dozen3':  return result >= 25 && result <= 36                    ? 3  : 0;
    case 'column1': return result > 0 && result % 3 === 1                  ? 3  : 0;
    case 'column2': return result > 0 && result % 3 === 2                  ? 3  : 0;
    case 'column3': return result > 0 && result % 3 === 0                  ? 3  : 0;
    case 'number':  return result === bet.number                           ? 36 : 0;
  }
}

/** ルーレット盤上のホイール順 (European wheel order). */
export const WHEEL = [
  0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26,
];
