// 各ゲームの画面を "テキスト + Application Emoji" 文字列で組み立てるフォーマッタ。
// Application Emoji の ID は src/ui/emoji-ids.ts に (アップロード後に) 生成される。
// 未アップロード時は emoji() が空文字を返すので、テキスト部分だけで表示が成立する。
import { emoji, EMOJI_IDS } from './emoji-ids.js';
const SUIT_NAME = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const RANK_NAME = (r) => {
    if (r === 'A')
        return 'a';
    if (r === 'J')
        return 'j';
    if (r === 'Q')
        return 'q';
    if (r === 'K')
        return 'k';
    if (r === 'T')
        return '10'; // デッキ上の 10 は 'T'、絵文字名は card_*_10
    return String(r);
};
function cardEmoji(card) {
    if (card === 'back')
        return emoji('card_back') || '🂠';
    const name = `card_${SUIT_NAME[card.suit]}_${RANK_NAME(card.rank)}`;
    // Fallback: emoji 未登録時は "A♠" 等のテキスト
    return emoji(name) || cardText(card);
}
/** ボタンに付けるカード絵文字。未登録なら null。 */
export function cardButtonEmoji(card) {
    const name = `card_${SUIT_NAME[card.suit]}_${RANK_NAME(card.rank)}`;
    const id = EMOJI_IDS[name];
    return id ? { id, name } : null;
}
export function cardText(card) {
    return `${rankLabel(card.rank)}${suitGlyph(card.suit)}`;
}
function rankLabel(r) { return r === 'T' ? '10' : String(r); }
function suitGlyph(s) { return ({ S: '♠', H: '♥', D: '♦', C: '♣' })[s]; }
function row(cards) {
    return cards.map(cardEmoji).join(' ');
}
/** 絵文字だけの行を Discord の最大見出し (#) で大きく表示する。文字は混ぜないこと。 */
function big(emojis) {
    return `# ${emojis}`;
}
export function formatBlackjack(i) {
    const lines = [];
    // Dealer
    const dealerCards = i.hideHole && i.dealer.length >= 2
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
        if (i.results?.[idx]) {
            const res = i.results[idx];
            const resLabel = res === 'bj' ? '✨ BLACKJACK' : res === 'win' ? '✅ WIN' : res === 'push' ? '➖ PUSH' : '❌ LOSE';
            lines.push(`${marker}${resLabel}`);
        }
    });
    return lines.join('\n');
}
const SLOT_EMOJI_NAME = {
    '🍒': 'slot_cherry', '🍋': 'slot_lemon', '🍊': 'slot_orange',
    '🍉': 'slot_melon', '⭐': 'slot_star', '🔔': 'slot_bell',
    '💎': 'slot_diamond', '7️⃣': 'slot_seven',
};
function slotEmoji(s) {
    const name = SLOT_EMOJI_NAME[s.id];
    return (name && emoji(name)) || s.id;
}
export function formatSlots(i) {
    const lines = [];
    lines.push(big(`${slotEmoji(i.reels[0])} ${slotEmoji(i.reels[1])} ${slotEmoji(i.reels[2])}`));
    if (!i.spinning) {
        if (i.payoutMult > 0) {
            const win = i.bet * i.payoutMult;
            const label = i.label ? ` ${i.label}` : '';
            lines.push(`**+${win.toLocaleString()} chips**  (${i.payoutMult}x)${label}`);
        }
    }
    else {
        lines.push('_spinning…_');
    }
    return lines.join('\n');
}
const RED_SET = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
function rouletteColor(n) {
    if (n === 0)
        return 'green';
    return RED_SET.has(n) ? 'red' : 'black';
}
export function formatRoulette(i) {
    const chip = emoji(`rl_${i.resultNumber}`);
    const color = rouletteColor(i.resultNumber);
    const colorMark = color === 'red' ? '🟥' : color === 'black' ? '⬛' : '🟩';
    const num = chip || `${colorMark} ${i.resultNumber}`;
    const lines = [];
    if (i.spinning) {
        lines.push(`🎡 spinning…  bet: **${i.betLabel}**`);
    }
    else {
        lines.push(`Result  _(${color})_`);
        lines.push(big(num));
        const win = i.betAmount * i.payoutMult;
        const net = win - i.betAmount;
        if (i.payoutMult > 0) {
            lines.push(`**+${net.toLocaleString()}**  (bet ${i.betLabel} ×${i.payoutMult})`);
        }
        else {
            lines.push(`**-${i.betAmount.toLocaleString()}**  (bet ${i.betLabel})`);
        }
    }
    return lines.join('\n');
}
export function formatBaccarat(i) {
    const net = i.payout - i.bet;
    const winnerLabel = i.winner === 'tie' ? 'TIE' : i.winner === 'player' ? 'PLAYER WINS' : 'BANKER WINS';
    const msg = net > 0 ? `**+${net.toLocaleString()} chips**` : net < 0 ? `**${net.toLocaleString()} chips**` : '**PUSH**';
    return [
        `**Player** (${i.playerTotal})`,
        big(row(i.player)),
        '',
        `**Banker** (${i.bankerTotal})`,
        big(row(i.banker)),
        '',
        `${winnerLabel}  —  ${msg}  (bet ${i.side} ${i.bet.toLocaleString()})`,
    ].join('\n');
}
export function formatVideoPoker(i) {
    const cards = i.hand.cards.map(c => cardEmoji(c));
    const heldPos = i.hand.held.flatMap((h, idx) => h ? [`${idx + 1}`] : []);
    const lines = [
        big(cards.join(' ')),
    ];
    if (i.phase === 'deal') {
        lines.push(heldPos.length ? `HOLD 中: ${heldPos.join(', ')} 枚目  _(DRAW で引き直し)_` : '_HOLD を選んで DRAW_');
    }
    if (i.phase === 'drawn') {
        if (i.payoutMult && i.payoutMult > 0) {
            lines.push(`**${i.rankLabel ?? ''}**  +${(i.bet * i.payoutMult).toLocaleString()} chips  (${i.payoutMult}x)`);
        }
        else {
            lines.push(`**-${i.bet.toLocaleString()}**  (no win)`);
        }
    }
    return lines.join('\n');
}
function diceEmoji(n) {
    return emoji(`dice_${n}`) || (['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][n] ?? String(n));
}
/** 直近の出目を大きく表示する行。 */
export function crapsDiceLine(d1, d2) {
    return big(`${diceEmoji(d1)} ${diceEmoji(d2)}`);
}
export function formatCraps(i) {
    const lines = [];
    lines.push(crapsDiceLine(i.dice[0], i.dice[1]));
    lines.push(`= **${i.total}**`);
    lines.push(i.phase === 'comeout' ? '_(Come-out roll)_' : `_(Point: **${i.point}**)_`);
    if (i.log?.length) {
        lines.push('');
        lines.push('```');
        for (const l of i.log.slice(-5))
            lines.push(l);
        lines.push('```');
    }
    lines.push(`Active bets: ${i.betCount}`);
    return lines.join('\n');
}
