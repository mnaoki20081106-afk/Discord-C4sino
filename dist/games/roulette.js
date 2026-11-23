import { randomInt } from 'node:crypto';
// European single-zero (0-36)。ハウスエッジ 2.7%。
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export function spinRoulette() { return randomInt(0, 37); }
/** 払出が cap を超えない結果が出るまで回し直す。 */
export function spinRouletteWithCap(bet, payCap) {
    const MAX = 64;
    for (let i = 0; i < MAX; i++) {
        const r = spinRoulette();
        if (bet.amount * payoutMult(bet, r) <= payCap)
            return r;
    }
    // 最後のあがき: ハズレになる数字を手動で選ぶ (0 はたいてい外れる)
    for (let r = 0; r < 37; r++) {
        if (payoutMult(bet, r) === 0)
            return r;
    }
    return 0;
}
export const isRed = (n) => RED.has(n);
export const isBlack = (n) => n > 0 && !RED.has(n);
export const color = (n) => n === 0 ? 'green' : (isRed(n) ? 'red' : 'black');
/** 当選時の配当倍率 (bet 含む gross)。負けなら 0。 */
export function payoutMult(bet, result) {
    switch (bet.kind) {
        case 'red': return isRed(result) ? 2 : 0;
        case 'black': return isBlack(result) ? 2 : 0;
        case 'odd': return result > 0 && result % 2 === 1 ? 2 : 0;
        case 'even': return result > 0 && result % 2 === 0 ? 2 : 0;
        case 'low': return result >= 1 && result <= 18 ? 2 : 0;
        case 'high': return result >= 19 && result <= 36 ? 2 : 0;
        case 'dozen1': return result >= 1 && result <= 12 ? 3 : 0;
        case 'dozen2': return result >= 13 && result <= 24 ? 3 : 0;
        case 'dozen3': return result >= 25 && result <= 36 ? 3 : 0;
        case 'column1': return result > 0 && result % 3 === 1 ? 3 : 0;
        case 'column2': return result > 0 && result % 3 === 2 ? 3 : 0;
        case 'column3': return result > 0 && result % 3 === 0 ? 3 : 0;
        case 'number': return result === bet.number ? 36 : 0;
    }
}
/** ルーレット盤上のホイール順 (European wheel order). */
export const WHEEL = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
