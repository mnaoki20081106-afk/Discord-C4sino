import { newShoe } from './blackjack.js';
export function cardPoint(c) {
    if (c.rank === 'A')
        return 1;
    if (['T', 'J', 'Q', 'K'].includes(c.rank))
        return 0;
    return parseInt(c.rank, 10);
}
export const totalPoints = (hand) => hand.reduce((s, c) => s + cardPoint(c), 0) % 10;
/** 1 回のシュー消費でハンドを決着させる。 */
export function dealBaccarat(shoe) {
    const s = shoe ?? newShoe();
    const player = [s.pop(), s.pop()];
    const banker = [s.pop(), s.pop()];
    let pt = totalPoints(player), bt = totalPoints(banker);
    // ナチュラル (8-9) チェック
    if (pt >= 8 || bt >= 8) {
        return decide(player, banker, pt, bt);
    }
    // Player 第3枚
    let playerThird = null;
    if (pt <= 5) {
        playerThird = s.pop();
        player.push(playerThird);
        pt = totalPoints(player);
    }
    // Banker 第3枚 (ルールテーブル)
    let bankerDraw = false;
    if (playerThird === null) {
        // Player stood → Banker 0-5 draw, 6-7 stand
        if (bt <= 5)
            bankerDraw = true;
    }
    else {
        const p3 = cardPoint(playerThird);
        switch (bt) {
            case 0:
            case 1:
            case 2:
                bankerDraw = true;
                break;
            case 3:
                bankerDraw = p3 !== 8;
                break;
            case 4:
                bankerDraw = p3 >= 2 && p3 <= 7;
                break;
            case 5:
                bankerDraw = p3 >= 4 && p3 <= 7;
                break;
            case 6:
                bankerDraw = p3 >= 6 && p3 <= 7;
                break;
            default: bankerDraw = false; // 7 以上はスタンド
        }
    }
    if (bankerDraw) {
        banker.push(s.pop());
        bt = totalPoints(banker);
    }
    return decide(player, banker, pt, bt);
}
function decide(player, banker, pt, bt) {
    const winner = pt > bt ? 'player' : pt < bt ? 'banker' : 'tie';
    return { player, banker, playerTotal: pt, bankerTotal: bt, winner };
}
export function dealBaccaratWithCap(side, bet, payCap) {
    const MAX = 64;
    for (let i = 0; i < MAX; i++) {
        const r = dealBaccarat();
        const mult = payoutMult(side, r.winner);
        if (bet * mult <= payCap)
            return r;
    }
    // ハズレ結果を強制: side 以外が勝つシュミをもう一度回し続ける
    let r;
    do {
        r = dealBaccarat();
    } while (payoutMult(side, r.winner) !== 0);
    return r;
}
/** 掛けに対する gross payout 倍率 (bet 含む)。負けは 0。 */
export function payoutMult(side, winner) {
    if (side === winner) {
        if (side === 'player')
            return 2;
        if (side === 'banker')
            return 1.95; // 5% コミ
        if (side === 'tie')
            return 9; // 8:1 + bet 返却
    }
    // Tie のときに Player/Banker ベットは bet が返却 (push) — 一般的ルール
    if (winner === 'tie' && (side === 'player' || side === 'banker'))
        return 1;
    return 0;
}
