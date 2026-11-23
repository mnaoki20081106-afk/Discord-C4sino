import { randomInt } from 'node:crypto';
export const rollDie = () => randomInt(1, 7);
export const rollDice = () => [rollDie(), rollDie()];
/** 各ベットの最大 gross 倍率 (bet 含む payout)。流動性ガード用。 */
export const MULT = {
    pass: 2, dontpass: 2, pass_odds: 3, dontpass_odds: 2,
    come: 2, dontcome: 2,
    field: 3, // 2/12 で ×3 (3:1 payout)
    place4: 2.8, place5: 2.4, place6: 2.1667, place8: 2.1667, place9: 2.4, place10: 2.8,
    hard4: 8, hard6: 10, hard8: 10, hard10: 8,
    big6: 2, big8: 2,
    any7: 5, anycraps: 8,
    yo11: 16, snakeeyes: 31, acedeuce: 16, boxcars: 31,
};
export function newCraps() {
    return { phase: 'comeout', nextBetId: 1, bets: [], history: [], totalWagered: 0, totalReturned: 0 };
}
export function addBet(st, kind, amount) {
    const b = { id: st.nextBetId++, kind, amount };
    st.bets.push(b);
    st.totalWagered += amount;
    return b;
}
function rollOnce(st) {
    const d1 = rollDie(), d2 = rollDie();
    const total = d1 + d2;
    const hard = d1 === d2;
    const comeout = st.phase === 'comeout';
    const point = st.point;
    const resolutions = st.bets.map(b => resolveBet(b, total, hard, comeout, point));
    return { d1, d2, total, hard, resolutions };
}
export function roll(st, payCap) {
    let attempt = rollOnce(st);
    if (payCap !== undefined) {
        const sumPayout = (rs) => rs.reduce((s, r) => s + r.payout, 0);
        let best = attempt;
        for (let t = 0; t < 64; t++) {
            if (sumPayout(attempt.resolutions) <= payCap)
                break;
            attempt = rollOnce(st);
            if (sumPayout(attempt.resolutions) < sumPayout(best.resolutions))
                best = attempt;
        }
        if (sumPayout(attempt.resolutions) > payCap)
            attempt = best;
    }
    const { d1, d2, total, resolutions } = attempt;
    const comeout = st.phase === 'comeout';
    const point = st.point;
    // フェーズ遷移 (pass/dontpass 系のベットが無くても更新する)
    let phaseChange;
    let newPoint;
    if (comeout) {
        if ([4, 5, 6, 8, 9, 10].includes(total)) {
            phaseChange = 'pointSet';
            newPoint = total;
        }
    }
    else {
        if (total === point)
            phaseChange = 'pointHit';
        else if (total === 7)
            phaseChange = 'seven_out';
    }
    // ログ
    let line = `🎲 ${d1}+${d2} = ${total}`;
    if (phaseChange === 'pointSet')
        line += `  ·  POINT ${total} 成立`;
    if (phaseChange === 'pointHit')
        line += `  ·  POINT ${point} HIT!`;
    if (phaseChange === 'seven_out')
        line += `  ·  SEVEN OUT`;
    return { d1, d2, total, resolutions, phaseChange, newPoint, log: line };
}
function resolveBet(b, total, hard, comeout, point) {
    const stay = (s) => s;
    const win = (mult) => ({ bet: b, payout: Math.floor(b.amount * mult), stay: false });
    const lose = () => ({ bet: b, payout: 0, stay: false });
    const push = () => ({ bet: b, payout: b.amount, stay: false });
    const keep = () => ({ bet: b, payout: 0, stay: true });
    switch (b.kind) {
        case 'pass':
            if (comeout) {
                if (total === 7 || total === 11)
                    return win(2);
                if (total === 2 || total === 3 || total === 12)
                    return lose();
                return keep();
            }
            if (total === point)
                return win(2);
            if (total === 7)
                return lose();
            return keep();
        case 'dontpass':
            if (comeout) {
                if (total === 7 || total === 11)
                    return lose();
                if (total === 2 || total === 3)
                    return win(2);
                if (total === 12)
                    return push(); // bar 12
                return keep();
            }
            if (total === point)
                return lose();
            if (total === 7)
                return win(2);
            return keep();
        case 'pass_odds':
            if (comeout || !point)
                return push(); // ポイント無効 → 返却
            if (total === point) {
                const m = (point === 4 || point === 10) ? 3
                    : (point === 5 || point === 9) ? 2.5
                        : 2.2;
                return win(m);
            }
            if (total === 7)
                return lose();
            return keep();
        case 'dontpass_odds':
            if (comeout || !point)
                return push();
            if (total === point)
                return lose();
            if (total === 7) {
                const m = (point === 4 || point === 10) ? 1.5
                    : (point === 5 || point === 9) ? 1.6666667
                        : 1.8333333;
                return win(m);
            }
            return keep();
        case 'come':
            if (!b.point) {
                // come bet の come-out roll (ポイント確立前)
                if (total === 7 || total === 11)
                    return win(2);
                if (total === 2 || total === 3 || total === 12)
                    return lose();
                // ポイント確立
                return { bet: b, payout: 0, stay: true, pointMoved: total };
            }
            if (total === b.point)
                return win(2);
            if (total === 7)
                return lose();
            return keep();
        case 'dontcome':
            if (!b.point) {
                if (total === 7 || total === 11)
                    return lose();
                if (total === 2 || total === 3)
                    return win(2);
                if (total === 12)
                    return push();
                return { bet: b, payout: 0, stay: true, pointMoved: total };
            }
            if (total === b.point)
                return lose();
            if (total === 7)
                return win(2);
            return keep();
        case 'field':
            if (total === 2 || total === 12)
                return win(3);
            if ([3, 4, 9, 10, 11].includes(total))
                return win(2);
            return lose();
        case 'place4':
        case 'place5':
        case 'place6':
        case 'place8':
        case 'place9':
        case 'place10': {
            const num = parseInt(b.kind.replace('place', ''), 10);
            if (comeout)
                return keep(); // OFF during come-out
            if (total === num) {
                const m = (num === 4 || num === 10) ? 2.8
                    : (num === 5 || num === 9) ? 2.4
                        : 2.1667;
                // Place bet は勝利時も据え置き (press/collect UX は省略) — 払戻しだけ返して amount は残す
                return { bet: b, payout: Math.floor(b.amount * (m - 1)), stay: true };
            }
            if (total === 7)
                return lose();
            return keep();
        }
        case 'hard4':
        case 'hard6':
        case 'hard8':
        case 'hard10': {
            const num = parseInt(b.kind.replace('hard', ''), 10);
            if (comeout)
                return keep(); // hard は OFF during come-out
            if (total === num && hard) {
                const m = (num === 4 || num === 10) ? 8 : 10;
                return { bet: b, payout: Math.floor(b.amount * (m - 1)), stay: true };
            }
            if (total === num && !hard)
                return lose(); // easy way → lose
            if (total === 7)
                return lose();
            return keep();
        }
        case 'big6':
        case 'big8': {
            const num = b.kind === 'big6' ? 6 : 8;
            if (total === num)
                return { bet: b, payout: b.amount, stay: true }; // 1:1
            if (total === 7)
                return lose();
            return keep();
        }
        case 'any7': return total === 7 ? win(5) : lose();
        case 'anycraps': return [2, 3, 12].includes(total) ? win(8) : lose();
        case 'yo11': return total === 11 ? win(16) : lose();
        case 'snakeeyes': return total === 2 ? win(31) : lose();
        case 'acedeuce': return total === 3 ? win(16) : lose();
        case 'boxcars': return total === 12 ? win(31) : lose();
    }
}
/** 流動性ガード用: 現在の全ベットの「最大未決済 gross」合計。 */
export function openExposure(st) {
    let sum = 0;
    for (const b of st.bets)
        sum += b.amount * MULT[b.kind];
    return sum;
}
