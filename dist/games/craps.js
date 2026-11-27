/**
 * Craps — 台の状態と配当の計算。ここでは I/O をしない (残高・運営の払える額の判定は tables.ts / liquidity.ts)。
 *
 * - サイコロは `rollDice()` の出目をそのまま使う。払戻しの都合で出目を振り直すことはしない。
 *   運営の残高を超える払戻しは、賭けを置く時と ROLL の直前に `worstExposure` で止める。
 * - 同じ種類の賭けは 1 つにまとめる (Place 6 を 2 回置けば ¥合計の 1 つ)。
 * - Pass / Come は、1 回でも振られたら外せない (外せると、ポイントが 4・10 のときだけ返金で逃げられて
 *   プレイヤー有利になるため)。それ以外の賭けはいつでも外せる。
 */
import { randomInt } from 'node:crypto';
export const rollDie = () => randomInt(1, 7);
export const rollDice = () => [rollDie(), rollDie()];
export const KIND_INFO = {
    pass: { name: 'Pass Line', when: 'comeout', note: '×2 / 7・11 勝ち、2・3・12 負け。ポイント後は外せません' },
    dontpass: { name: "Don't Pass", when: 'comeout', note: '×2 / Pass の逆。12 は引き分け' },
    pass_odds: { name: 'Pass Odds', when: 'point', note: '×2.2〜3 / ポイントに上乗せ。ハウスエッジなし' },
    dontpass_odds: { name: "Don't Pass Odds", when: 'point', note: '×1.5〜1.83 / 7 が先なら勝ち。ハウスエッジなし' },
    come: { name: 'Come', when: 'point', note: '×2 / 出た目がこの賭けのポイントになる。決着まで外せません' },
    dontcome: { name: "Don't Come", when: 'point', note: '×2 / Come の逆。12 は引き分け' },
    field: { name: 'Field', note: '3・4・9・10・11 で ×2 / 2・12 で ×3 / 1 回で決着' },
    place4: { name: 'Place 4', note: '4 で配当 9:5 (×2.8)、7 で負け / コムアウト中は休み' },
    place5: { name: 'Place 5', note: '5 で配当 7:5 (×2.4)、7 で負け / コムアウト中は休み' },
    place6: { name: 'Place 6', note: '6 で配当 7:6 (×2.17)、7 で負け / コムアウト中は休み' },
    place8: { name: 'Place 8', note: '8 で配当 7:6 (×2.17)、7 で負け / コムアウト中は休み' },
    place9: { name: 'Place 9', note: '9 で配当 7:5 (×2.4)、7 で負け / コムアウト中は休み' },
    place10: { name: 'Place 10', note: '10 で配当 9:5 (×2.8)、7 で負け / コムアウト中は休み' },
    hard4: { name: 'Hard 4', note: '2+2 で ×8。他の 4 か 7 で負け / コムアウト中は休み' },
    hard6: { name: 'Hard 6', note: '3+3 で ×10。他の 6 か 7 で負け / コムアウト中は休み' },
    hard8: { name: 'Hard 8', note: '4+4 で ×10。他の 8 か 7 で負け / コムアウト中は休み' },
    hard10: { name: 'Hard 10', note: '5+5 で ×8。他の 10 か 7 で負け / コムアウト中は休み' },
    big6: { name: 'Big 6', note: '6 で配当 1:1 (×2)、7 で負け' },
    big8: { name: 'Big 8', note: '8 で配当 1:1 (×2)、7 で負け' },
    any7: { name: 'Any 7', note: '7 で ×5 / 1 回で決着' },
    anycraps: { name: 'Any Craps', note: '2・3・12 で ×8 / 1 回で決着' },
    yo11: { name: 'Yo 11', note: '11 で ×16 / 1 回で決着' },
    snakeeyes: { name: 'Snake Eyes', note: '2 (1+1) で ×31 / 1 回で決着' },
    acedeuce: { name: 'Ace-Deuce', note: '3 (1+2) で ×16 / 1 回で決着' },
    boxcars: { name: 'Boxcars', note: '12 (6+6) で ×31 / 1 回で決着' },
};
/** メニューの並び順 */
export const KIND_ORDER = Object.keys(KIND_INFO);
export const isCrapsKind = (s) => Object.hasOwn(KIND_INFO, s);
/** 台に同時に置ける賭けの数 (embed に収めるため) */
export const MAX_BETS = 20;
export function newCraps() {
    return { phase: 'comeout', nextBetId: 1, bets: [], history: [], totalWagered: 0, totalReturned: 0, undo: [] };
}
/* ────────────── 賭けの置き方・外し方 ────────────── */
const isContract = (k) => k === 'pass' || k === 'come';
/** 1 回でも振られた Pass / Come は外せない */
export const isLocked = (b) => b.rolled > 0 && isContract(b.kind);
export const tableStake = (bets) => bets.reduce((s, b) => s + b.amount, 0);
const addMix = (a, b) => ({ pp: a.pp + b.pp, ltc: a.ltc + b.ltc });
const subMix = (a, b) => ({ pp: Math.max(0, a.pp - b.pp), ltc: Math.max(0, a.ltc - b.ltc) });
/** 賭けの元の額の内訳。mix が無い (テスト) 賭けは PayPay 扱い。 */
export const stakeOf = (b) => b.mix ?? { pp: b.amount, ltc: 0 };
/** 台の上の賭けの元の額の内訳 */
export const tableStakeRails = (bets) => bets.reduce((m, b) => addMix(m, stakeOf(b)), { pp: 0, ltc: 0 });
/** 払戻し (または返金) を、賭けの内訳で PayPay / LTC に分ける。`payoutByMix` と同じ丸め方。 */
export function splitByMix(amount, mix) {
    if (amount <= 0)
        return { pp: 0, ltc: 0 };
    const total = mix ? mix.pp + mix.ltc : 0;
    if (!mix || total <= 0)
        return { pp: amount, ltc: 0 };
    const ltc = Math.floor(amount * mix.ltc / total);
    return { pp: amount - ltc, ltc };
}
/** 合計だけ指定して、内訳の比率を保ったまま縮める */
export function scaleMix(mix, amount) {
    return splitByMix(amount, mix);
}
/** 今の局面で置ける種類。置けない理由は `whyNot`。 */
export function availableKinds(st) {
    return KIND_ORDER.filter(k => { const w = KIND_INFO[k].when; return !w || w === st.phase; });
}
export function whyNot(st, kind) {
    const w = KIND_INFO[kind].when;
    if (!w || w === st.phase)
        return null;
    return w === 'point'
        ? `${KIND_INFO[kind].name} はポイントが決まってから置けます`
        : `${KIND_INFO[kind].name} はコムアウト (ポイントが無いとき) だけ置けます`;
}
/** 台に置く。同じ種類の賭けがあればその額に足す。 */
export function addBet(st, kind, amount, mix) {
    let bet = st.bets.find(b => b.kind === kind && b.point === undefined && !isLocked(b) && (b.rolled === 0 || !isContract(kind)));
    if (bet) {
        bet.amount += amount;
        if (mix)
            bet.mix = bet.mix ? addMix(bet.mix, mix) : mix;
    }
    else {
        bet = { id: st.nextBetId++, kind, amount, mix, rolled: 0 };
        st.bets.push(bet);
    }
    st.undo.push({ betId: bet.id, amount, mix });
    st.totalWagered += amount;
    st.lastResult = undefined;
    return bet;
}
/** 状態を変えずに「この賭けを足したあとの台」を返す (運営の残高の判定用)。 */
export function withBet(st, kind, amount, mix) {
    const copy = structuredClone(st);
    addBet(copy, kind, amount, mix);
    return copy;
}
/** 直前に置いた分を戻す。戻した額と内訳を返す。戻せるものが無ければ null。 */
export function undoLast(st) {
    while (st.undo.length) {
        const p = st.undo.pop();
        const idx = st.bets.findIndex(b => b.id === p.betId);
        if (idx < 0)
            continue;
        const b = st.bets[idx];
        if (isLocked(b) || b.amount < p.amount)
            continue;
        b.amount -= p.amount;
        if (b.mix && p.mix)
            b.mix = subMix(b.mix, p.mix);
        const name = betName(b);
        if (b.amount === 0)
            st.bets.splice(idx, 1);
        st.totalWagered -= p.amount;
        st.lastResult = undefined;
        return { amount: p.amount, mix: p.mix, name };
    }
    return null;
}
/** 外せる賭けをすべて外す (Pass / Come で振られたものだけ残る)。 */
export function takeDown(st) {
    const gone = st.bets.filter(b => !isLocked(b));
    st.bets = st.bets.filter(isLocked);
    st.undo = [];
    const amount = tableStake(gone);
    st.totalWagered -= amount;
    if (gone.length)
        st.lastResult = undefined;
    return { amount, mix: gone.length && gone.every(b => b.mix) ? tableStakeRails(gone) : undefined, count: gone.length };
}
export const betName = (b) => KIND_INFO[b.kind].name + (b.point ? ` (${b.point})` : '');
function resolveBet(b, total, hard, comeout, point) {
    const win = (mult) => ({ bet: b, payout: Math.floor(b.amount * mult), stay: false, outcome: 'win' });
    const lose = () => ({ bet: b, payout: 0, stay: false, outcome: 'lose' });
    const push = () => ({ bet: b, payout: b.amount, stay: false, outcome: 'push' });
    const keep = () => ({ bet: b, payout: 0, stay: true, outcome: 'stay' });
    /** 利益だけ払って賭けは残す */
    const winStay = (profitMult) => ({ bet: b, payout: Math.floor(b.amount * profitMult), stay: true, outcome: 'win' });
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
                if (total === 7 || total === 11)
                    return win(2);
                if (total === 2 || total === 3 || total === 12)
                    return lose();
                return { bet: b, payout: 0, stay: true, pointMoved: total, outcome: 'moved' };
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
                return { bet: b, payout: 0, stay: true, pointMoved: total, outcome: 'moved' };
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
                return keep(); // コムアウト中は休み
            if (total === num) {
                const m = (num === 4 || num === 10) ? 2.8
                    : (num === 5 || num === 9) ? 2.4
                        : 2.1667;
                return winStay(m - 1);
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
                return keep();
            if (total === num && hard)
                return winStay(((num === 4 || num === 10) ? 8 : 10) - 1);
            if (total === num && !hard)
                return lose(); // easy way
            if (total === 7)
                return lose();
            return keep();
        }
        case 'big6':
        case 'big8': {
            const num = b.kind === 'big6' ? 6 : 8;
            if (total === num)
                return winStay(1); // 1:1
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
/** 出目 (d1, d2) が出たときの判定。台の状態も賭けも書き換えない。 */
export function evaluate(st, d1, d2) {
    const total = d1 + d2;
    const hard = d1 === d2;
    const comeout = st.phase === 'comeout';
    const resolutions = st.bets.map(b => resolveBet(b, total, hard, comeout, st.point));
    let phaseChange;
    let newPoint;
    if (comeout) {
        if ([4, 5, 6, 8, 9, 10].includes(total)) {
            phaseChange = 'pointSet';
            newPoint = total;
        }
    }
    else if (total === st.point)
        phaseChange = 'pointHit';
    else if (total === 7)
        phaseChange = 'seven_out';
    let log = `🎲 ${d1}+${d2} = ${total}`;
    if (phaseChange === 'pointSet')
        log += `  ·  POINT ${total}`;
    if (phaseChange === 'pointHit')
        log += `  ·  POINT ${st.point} HIT`;
    if (phaseChange === 'seven_out')
        log += `  ·  SEVEN OUT`;
    return { d1, d2, total, resolutions, phaseChange, newPoint, log };
}
const yen = (n) => `¥${n.toLocaleString()}`;
function describe(r) {
    const b = r.bet, name = betName(b);
    switch (r.outcome) {
        case 'win': return r.stay
            ? `✅ ${name} ${yen(b.amount)} → **+${yen(r.payout)}** (賭けは台に残ります)`
            : `✅ ${name} ${yen(b.amount)} → **${yen(r.payout)}** (+${yen(r.payout - b.amount)})`;
        case 'lose': return `❌ ${name} ${yen(b.amount)} → LOSE`;
        case 'push': return `➖ ${name} ${yen(b.amount)} → 返金`;
        case 'moved': return `➡️ ${name} ${yen(b.amount)} → ポイント ${r.pointMoved} に移動`;
        default: return null;
    }
}
/** 判定を台に反映する。ROLL ごとに 1 回だけ呼ぶ。 */
export function applyRoll(st, rep) {
    const lines = [];
    let wager = 0, payout = 0, resolved = 0;
    const stay = [];
    for (const r of rep.resolutions) {
        payout += r.payout;
        if (!r.stay) {
            wager += r.bet.amount;
            resolved++;
        }
        const l = describe(r);
        if (l)
            lines.push(l);
        if (r.stay) {
            r.bet.rolled++;
            if (r.pointMoved)
                r.bet.point = r.pointMoved;
            stay.push(r.bet);
        }
    }
    st.bets = stay;
    if (rep.phaseChange === 'pointSet') {
        st.phase = 'point';
        st.point = rep.newPoint;
    }
    if (rep.phaseChange === 'pointHit' || rep.phaseChange === 'seven_out') {
        st.phase = 'comeout';
        st.point = undefined;
    }
    st.lastRoll = [rep.d1, rep.d2];
    st.totalReturned += payout;
    st.history.push(rep.log);
    if (st.history.length > 20)
        st.history.shift();
    st.undo = [];
    const shown = lines.length > 10 ? [...lines.slice(0, 10), `…ほか ${lines.length - 10} 件`] : lines;
    st.lastResult = { lines: shown, wager, payout, resolved };
    return st.lastResult;
}
/* ────────────── 運営が払える額の判定 ────────────── */
/** 出目 (d1, d2) の直後に、この台が運営に対して持つ債務 (PayPay / LTC 別)。払戻し + 台に残る元の額。 */
function liabilityAfter(st, d1, d2) {
    const total = d1 + d2, hard = d1 === d2, comeout = st.phase === 'comeout';
    let sum = { pp: 0, ltc: 0 };
    for (const b of st.bets) {
        const r = resolveBet(b, total, hard, comeout, st.point);
        sum = addMix(sum, splitByMix(r.payout, b.mix));
        if (r.stay)
            sum = addMix(sum, stakeOf(b));
    }
    return sum;
}
/**
 * この台が次の ROLL までに運営に対して負いうる最大の額 (PayPay / LTC 別)。
 * 36 通りの出目をすべて試し、各レールの最大を取る。台の上の元の額 (UNDO で戻る分) より小さくはならない。
 * 運営の払える額 (= 運営ウォレット − ユーザーの残高 − 他の台の確保分) がこれ以上であれば、どの出目でも払える。
 */
export function worstExposure(st) {
    let worst = tableStakeRails(st.bets);
    for (let d1 = 1; d1 <= 6; d1++) {
        for (let d2 = 1; d2 <= 6; d2++) {
            const m = liabilityAfter(st, d1, d2);
            if (m.pp > worst.pp)
                worst = { ...worst, pp: m.pp };
            if (m.ltc > worst.ltc)
                worst = { ...worst, ltc: m.ltc };
        }
    }
    return worst;
}
