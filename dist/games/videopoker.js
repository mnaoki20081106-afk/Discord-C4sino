import { newShoe } from './blackjack.js';
// Jacks or Better (9/6) — RTP ≈ 99.54%。配当倍率は gross (bet 含む)。
export const PAY = {
    royal_flush: 800,
    straight_flush: 50,
    four_of_a_kind: 25,
    full_house: 9,
    flush: 6,
    straight: 4,
    three_of_a_kind: 3,
    two_pair: 2,
    jacks_or_better: 1,
    nothing: 0,
};
const RANK_ORDER = {
    A: 14, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13,
};
export function evaluate(cards) {
    const ranks = cards.map(c => RANK_ORDER[c.rank]).sort((a, b) => a - b);
    const suits = cards.map(c => c.suit);
    const flush = suits.every(s => s === suits[0]);
    // straight: 連続 or A-2-3-4-5
    const uniq = [...new Set(ranks)];
    let straight = false;
    if (uniq.length === 5) {
        if (ranks[4] - ranks[0] === 4)
            straight = true;
        if (JSON.stringify(ranks) === JSON.stringify([2, 3, 4, 5, 14]))
            straight = true;
    }
    const royal = straight && flush && ranks[0] === 10 && ranks[4] === 14;
    // 同じランクの集計
    const counts = {};
    for (const r of ranks)
        counts[r] = (counts[r] ?? 0) + 1;
    const countVals = Object.values(counts).sort((a, b) => b - a);
    const pairs = Object.entries(counts).filter(([, c]) => c === 2);
    if (royal)
        return 'royal_flush';
    if (straight && flush)
        return 'straight_flush';
    if (countVals[0] === 4)
        return 'four_of_a_kind';
    if (countVals[0] === 3 && countVals[1] === 2)
        return 'full_house';
    if (flush)
        return 'flush';
    if (straight)
        return 'straight';
    if (countVals[0] === 3)
        return 'three_of_a_kind';
    if (pairs.length === 2)
        return 'two_pair';
    // Jacks or Better: J/Q/K/A のペア
    if (pairs.length === 1) {
        const r = parseInt(pairs[0][0], 10);
        if (r >= 11 || r === 14)
            return 'jacks_or_better';
    }
    return 'nothing';
}
export function startVP(shoe) {
    const s = shoe ?? newShoe();
    const cards = Array.from({ length: 5 }, () => s.pop());
    return { shoe: s, cards, held: [false, false, false, false, false], phase: 'deal' };
}
export function drawVP(hand) {
    if (hand.phase !== 'deal')
        return hand;
    for (let i = 0; i < 5; i++) {
        if (!hand.held[i])
            hand.cards[i] = hand.shoe.pop();
    }
    hand.phase = 'drawn';
    hand.rank = evaluate(hand.cards);
    return hand;
}
/** 払出が cap を超えない結果が出るまで、非HOLD カードを引き直す (最大 64 回)。 */
export function drawVPWithCap(hand, bet, payCap) {
    if (hand.phase !== 'deal')
        return hand;
    const origShoe = [...hand.shoe];
    const origCards = [...hand.cards];
    const MAX = 64;
    let best = { rank: 'nothing', cards: [...origCards], shoe: [...origShoe] };
    for (let t = 0; t < MAX; t++) {
        // Shuffle shoe snapshot and re-draw non-held
        const shoe = [...origShoe];
        for (let i = shoe.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
        }
        const cards = [...origCards];
        for (let i = 0; i < 5; i++)
            if (!hand.held[i])
                cards[i] = shoe.pop();
        const rank = evaluate(cards);
        if (bet * payoutFor(rank) <= payCap) {
            hand.shoe = shoe;
            hand.cards = cards;
            hand.phase = 'drawn';
            hand.rank = rank;
            return hand;
        }
        if (PAY[rank] < PAY[best.rank] || best.rank === 'nothing')
            best = { rank, cards: [...cards], shoe: [...shoe] };
    }
    // ハズレ強制: nothing が出るまで引く
    for (let t = 0; t < 256; t++) {
        const shoe = [...origShoe];
        for (let i = shoe.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
        }
        const cards = [...origCards];
        for (let i = 0; i < 5; i++)
            if (!hand.held[i])
                cards[i] = shoe.pop();
        const rank = evaluate(cards);
        if (rank === 'nothing') {
            hand.shoe = shoe;
            hand.cards = cards;
            hand.phase = 'drawn';
            hand.rank = rank;
            return hand;
        }
    }
    // fallback
    hand.cards = best.cards;
    hand.shoe = best.shoe;
    hand.phase = 'drawn';
    hand.rank = best.rank;
    return hand;
}
export function payoutFor(rank) {
    return PAY[rank] ?? 0;
}
