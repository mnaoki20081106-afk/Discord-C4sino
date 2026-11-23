import { randomInt } from 'node:crypto';
const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
export function newShoe(decks = 6) {
    const shoe = [];
    for (let d = 0; d < decks; d++)
        for (const s of SUITS)
            for (const r of RANKS)
                shoe.push({ suit: s, rank: r });
    // Fisher–Yates with crypto RNG
    for (let i = shoe.length - 1; i > 0; i--) {
        const j = randomInt(0, i + 1);
        [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
    }
    return shoe;
}
export function cardValue(c) {
    if (c.rank === 'A')
        return 11;
    if (['T', 'J', 'Q', 'K'].includes(c.rank))
        return 10;
    return parseInt(c.rank, 10);
}
export function handTotal(hand) {
    let total = 0, aces = 0;
    for (const c of hand) {
        total += cardValue(c);
        if (c.rank === 'A')
            aces++;
    }
    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }
    const soft = hand.some(c => c.rank === 'A') && hand.reduce((s, c) => s + cardValue(c), 0) === total;
    return { total, soft };
}
export const isBlackjack = (h) => h.length === 2 && handTotal(h).total === 21;
export const isBust = (h) => handTotal(h).total > 21;
export function startHand(bet, shoe) {
    const s = shoe ?? newShoe();
    const player = [[s.pop(), s.pop()]];
    const dealer = [s.pop(), s.pop()];
    return { shoe: s, player, dealer, bets: [bet], active: 0, phase: 'player' };
}
export function availableActions(st) {
    if (st.phase !== 'player')
        return [];
    const h = st.player[st.active];
    const acts = ['hit', 'stand'];
    if (h.length === 2) {
        acts.push('double');
        if (h[0].rank === h[1].rank && st.player.length < 4)
            acts.push('split');
    }
    return acts;
}
export function apply(st, action, payCap) {
    if (st.phase !== 'player')
        return st;
    const h = st.player[st.active];
    if (action === 'hit') {
        h.push(st.shoe.pop());
        if (isBust(h) || handTotal(h).total === 21)
            nextHand(st);
    }
    else if (action === 'stand') {
        nextHand(st);
    }
    else if (action === 'double') {
        st.bets[st.active] *= 2;
        h.push(st.shoe.pop());
        nextHand(st);
    }
    else if (action === 'split') {
        const c2 = h.pop();
        st.player.splice(st.active + 1, 0, [c2, st.shoe.pop()]);
        st.bets.splice(st.active + 1, 0, st.bets[st.active]);
        h.push(st.shoe.pop());
    }
    if (st.phase === 'dealer')
        settleDealer(st, payCap);
    return st;
}
function nextHand(st) {
    st.active++;
    if (st.active >= st.player.length)
        st.phase = 'dealer';
}
function dealerDraw(dealer, shoe) {
    while (true) {
        const { total, soft } = handTotal(dealer);
        if (total < 17 || (total === 17 && soft))
            dealer.push(shoe.pop());
        else
            break;
    }
}
function computeOutcome(st) {
    const dealerTotal = handTotal(st.dealer).total;
    const dealerBJ = isBlackjack(st.dealer);
    const results = [];
    let payout = 0;
    st.player.forEach((h, i) => {
        const t = handTotal(h).total;
        const bj = isBlackjack(h) && st.player.length === 1;
        if (bj && !dealerBJ) {
            results.push('bj');
            payout += Math.floor(st.bets[i] * 2.5);
            return;
        }
        if (bj && dealerBJ) {
            results.push('push');
            payout += st.bets[i];
            return;
        }
        if (!bj && dealerBJ) {
            results.push('lose');
            return;
        }
        if (t > 21) {
            results.push('lose');
            return;
        }
        if (dealerTotal > 21 || t > dealerTotal) {
            results.push('win');
            payout += st.bets[i] * 2;
            return;
        }
        if (t === dealerTotal) {
            results.push('push');
            payout += st.bets[i];
            return;
        }
        results.push('lose');
    });
    return { results, payout };
}
function settleDealer(st, payCap) {
    // 保存: ディーラー初期2枚と残りシュー
    const dealerInit = st.dealer.slice(0, 2);
    const shoeSnapshot = [...st.shoe];
    dealerDraw(st.dealer, st.shoe);
    let out = computeOutcome(st);
    // 払戻上限を超える場合、残シューを「シャッフル」してディーラーの引きだけやり直す
    // (プレイヤーの手札は維持。見えているカード順序だけ裏で入れ替え)
    if (payCap !== undefined && out.payout > payCap) {
        const MAX_TRIES = 64;
        let best = out;
        for (let t = 0; t < MAX_TRIES; t++) {
            // ディーラーの引きを巻き戻し、シューを再シャッフル
            st.dealer = [...dealerInit];
            // Fisher–Yates on snapshot
            const reshuffled = [...shoeSnapshot];
            for (let i = reshuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [reshuffled[i], reshuffled[j]] = [reshuffled[j], reshuffled[i]];
            }
            st.shoe = reshuffled;
            dealerDraw(st.dealer, st.shoe);
            out = computeOutcome(st);
            if (out.payout <= payCap)
                break;
            if (out.payout < best.payout)
                best = { ...out, results: [...out.results] };
        }
        if (out.payout > payCap) {
            // それでもダメなら最良の試行を採用
            st.dealer = [...dealerInit];
            dealerDraw(st.dealer, shoeSnapshot);
            out = best;
        }
    }
    st.phase = 'done';
    st.results = out.results;
    st.payout = out.payout;
}
