import { EmbedBuilder } from 'discord.js';
import { SYMBOLS } from '../games/slots.js';
import { MIN_DEPOSIT_JPY, MIN_BET_CHIPS, MAX_BET_CHIPS } from '../payments/limits.js';
import { L } from './leet.js';

export type GameKey = 'blackjack' | 'slots' | 'roulette' | 'baccarat' | 'videopoker' | 'craps' | 'cashier' | 'all';

/** スロットの実 RTP を重みから計算 */
export function computeSlotsRTP() {
  const total = SYMBOLS.reduce((s, x) => s + x.w, 0);
  const p: Record<string, number> = {};
  for (const s of SYMBOLS) p[s.id] = s.w / total;

  let rtp3 = 0;
  const lines3: Array<{ sym: string; prob: number; pay: number; ret: number }> = [];
  for (const s of SYMBOLS) {
    const prob = p[s.id] ** 3;
    const ret = prob * s.pay3;
    rtp3 += ret;
    lines3.push({ sym: s.id, prob, pay: s.pay3, ret });
  }

  const pc = p['🍒'];
  const cherry = SYMBOLS[0];
  const prob2c = pc * pc * (1 - pc);
  const ret2c = prob2c * cherry.pay2;
  const rtp = rtp3 + ret2c;

  return { rtp, rtp3, ret2c, prob2c, lines3, totalWeight: total };
}

function depositLine() {
  return `PayPay: **¥${MIN_DEPOSIT_JPY.paypay.toLocaleString()}** 〜  /  LTC: **¥${MIN_DEPOSIT_JPY.ltc.toLocaleString()}** 〜`;
}

export function blackjackOverview(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`🂡  ${L('BLACKJACK')} — ${L('OVERVIEW')}`)
    .setColor(0x0d5a3a)
    .setDescription(
      'ラスベガスルール準拠のブラックジャック。6デッキシュー、暗号学的乱数で毎局シャッフル。'
    )
    .addFields(
      { name: '🎯 Rules', value:
        '• 6-deck shoe / crypto RNG シャッフル\n' +
        '• ディーラーは **ソフト17 で hit (H17)**\n' +
        '• Blackjack は **3:2** 配当\n' +
        '• Double 可 (最初の2枚のみ, bet2倍で1枚のみ追加)\n' +
        '• Split 可 (同ランク2枚, 最大4ハンドまで)\n' +
        '• Insurance / Surrender なし',
        inline: false },
      { name: '💰 Payouts', value:
        '`Blackjack`  × **2.5** (純利 +1.5x)\n' +
        '`Win`         × **2.0** (純利 +1x)\n' +
        '`Push`        × **1.0** (bet 返却)\n' +
        '`Lose`        × **0**',
        inline: false },
      { name: '📊 RTP', value:
        '**RTP ≈ 99.5%**  /  House edge ≈ 0.5%\n' +
        'ベーシックストラテジー通りに打った場合の参考値。',
        inline: false },
      { name: '📐 Bet range',    value: `**${MIN_BET_CHIPS.blackjack.toLocaleString()}** 〜 **${MAX_BET_CHIPS.blackjack.toLocaleString()}** ${L('chips')}`, inline: true },
      { name: '💳 最低入金額',    value: depositLine(), inline: false },
    )
    .setFooter({ text: 'Discord C4sino · Blackjack Overview' });
}

export function slotsOverview(): EmbedBuilder {
  const r = computeSlotsRTP();
  const pct = (x: number) => `${(x * 100).toFixed(4)}%`;
  const cents = (x: number) => `${(x * 100).toFixed(2)}%`;

  const lines = r.lines3
    .sort((a, b) => b.pay - a.pay)
    .map(l => `\`${l.sym}×3\` — **×${l.pay}**  p=${pct(l.prob)}`)
    .join('\n');

  const sumWinProb = r.lines3.reduce((s, l) => s + l.prob, 0) + r.prob2c;
  const hitFreq = 1 / sumWinProb;
  const jackpotP = (SYMBOLS[7].w / r.totalWeight) ** 3;

  return new EmbedBuilder()
    .setTitle(`🎰  ${L('SLOTS')} — ${L('OVERVIEW')}`)
    .setColor(0x2d0a4e)
    .setDescription('3リール・8シンボルのクラシックスロット。各リール独立に重み付き抽選。')
    .addFields(
      { name: '💎 Payouts (3-of-a-kind)', value: lines, inline: false },
      { name: '🍒 Side line',
        value: `\`🍒🍒?\` (左2つがチェリー) — **×${SYMBOLS[0].pay2}**  p=${pct(r.prob2c)}`,
        inline: false },
      { name: '📊 RTP',
        value: `**RTP = ${(r.rtp * 100).toFixed(2)}%**  (House edge ${(100 - r.rtp*100).toFixed(2)}%)\n` +
               `3-of-a-kind ${cents(r.rtp3)}  /  2-cherry ${cents(r.ret2c)}`,
        inline: false },
      { name: '🎯 Hit frequency',
        value: `約 **${hitFreq.toFixed(1)} 回に 1 回** (${(sumWinProb*100).toFixed(2)}%)\n` +
               `🏆 JACKPOT 7️⃣×3: 約 ${Math.round(1/jackpotP).toLocaleString()} 回に 1 回`,
        inline: false },
      { name: '📐 Bet range',  value: `**${MIN_BET_CHIPS.slots.toLocaleString()}** 〜 **${MAX_BET_CHIPS.slots.toLocaleString()}** ${L('chips')}`, inline: true },
      { name: '💳 最低入金額',  value: depositLine(), inline: false },
    )
    .setFooter({ text: 'Discord C4sino · Slots Overview' });
}

export function rouletteOverview(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`🎡  ${L('EUROPEAN')} ${L('ROULETTE')} — ${L('OVERVIEW')}`)
    .setColor(0x0d5a3a)
    .setDescription(
      '0〜36 の 37 ポケットのホイールにボールが転がり、停止ポケットで勝敗が決まる。' +
      'ヨーロピアン型は 0 のみ（アメリカン型の 00 なし）で RTP が高い。'
    )
    .addFields(
      { name: '💰 Payouts', value:
        '**Outside Bets (低リスク)**\n' +
        '🟥 Red / ⬛ Black / Odd / Even / 1–18 / 19–36  → **×2**\n' +
        '**Dozen / Column**\n' +
        '1st12 / 2nd12 / 3rd12 / Col1 / Col2 / Col3  → **×3**\n' +
        '**Inside Bet (高リスク)**\n' +
        'Straight-up (単一数字 0–36)  → **×36**',
        inline: false },
      { name: '📊 RTP',   value: '**97.30%**  (House edge 2.70%)\nすべてのベット種別で同じ RTP。', inline: false },
      { name: '🎯 Odds',  value:
        'Red/Black/Odd/Even/1–18/19–36: **48.65%**\nDozen/Column: **32.43%**\nStraight-up: **2.70%**',
        inline: false },
      { name: '📐 Bet range', value: `**10** 〜 **50,000** ${L('chips')}`, inline: true },
      { name: '💳 最低入金額', value: depositLine(), inline: false },
    )
    .setFooter({ text: 'Discord C4sino · Roulette Overview' });
}

export function baccaratOverview(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`🎴  ${L('BACCARAT')} — ${L('OVERVIEW')}`)
    .setColor(0x0d5a3a)
    .setDescription('Punto Banco (標準) ルール。6-デッキシュー。')
    .addFields(
      { name: '🎯 Rules', value:
        '• Player / Banker にそれぞれ 2 枚ずつ配る\n' +
        '• 合計 8-9 はナチュラル (そのまま決着)\n' +
        '• Player: 0–5 で 3 枚目ドロー、6–7 でスタンド\n' +
        '• Banker: Player の 3 枚目に応じた標準テーブル\n' +
        '• 合計点は下一桁 (14 → 4)',
        inline: false },
      { name: '💰 Payouts', value:
        `${L('Player')}: **×2.0** (勝率 44.62%)\n` +
        `${L('Banker')}: **×1.95** (勝率 45.86%, 5% コミ)\n` +
        `${L('Tie')}: **×9.0** (発生率 9.52%)`,
        inline: false },
      { name: '📊 House edge', value: 'Banker **1.06%** / Player **1.24%** / Tie **14.4%**', inline: false },
      { name: '📐 Bet range', value: `**10** 〜 **50,000** ${L('chips')}`, inline: true },
      { name: '💳 最低入金額', value: depositLine(), inline: false },
    )
    .setFooter({ text: 'Discord C4sino · Baccarat Overview' });
}

export function videopokerOverview(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`🃏  ${L('VIDEO POKER')} — ${L('OVERVIEW')}`)
    .setColor(0x2d0a4e)
    .setDescription('Jacks or Better (9/6 標準)。5 枚の初手から HOLD を選んで DRAW。')
    .addFields(
      { name: '💰 Paytable (per 1 bet)', value:
        '`Royal Flush        ×800`\n' +
        '`Straight Flush     ×50`\n' +
        '`Four of a Kind     ×25`\n' +
        '`Full House         ×9`\n' +
        '`Flush              ×6`\n' +
        '`Straight           ×4`\n' +
        '`Three of a Kind    ×3`\n' +
        '`Two Pair           ×2`\n' +
        '`Jacks or Better    ×1`',
        inline: false },
      { name: '📊 RTP', value: '**99.54%** (最適プレイ時, 9/6 Jacks)', inline: false },
      { name: '📐 Bet range', value: `**10** 〜 **50,000** ${L('chips')}`, inline: true },
      { name: '💳 最低入金額', value: depositLine(), inline: false },
    )
    .setFooter({ text: 'Discord C4sino · Video Poker Overview' });
}

export function crapsOverview(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`🎲  ${L('CRAPS')} — ${L('OVERVIEW')}`)
    .setColor(0x0d5a3a)
    .setDescription('2 個のダイスで進行するマルチロール式ゲーム。Come-out → Point phase を繰り返す。')
    .addFields(
      { name: '🎯 Phase', value:
        '**Come-out roll**  7/11=Pass勝, 2/3/12=Pass負, 4-10=Point成立\n' +
        '**Point phase**   Point再出=Pass勝, 7=Seven-out (負)',
        inline: false },
      { name: '💰 Line Bets (House edge 低)', value:
        'Pass **×2** (edge 1.41%) / Don\'t Pass **×2** (edge 1.36%)\n' +
        'Come / Don\'t Come も同等\n' +
        'Pass Odds / Don\'t Pass Odds は **真の確率** (edge 0%)',
        inline: false },
      { name: '💰 Place / Hardways', value:
        'Place 4/10 **×2.8** (edge 6.67%) / 5/9 **×2.4** (4.0%) / 6/8 **×2.17** (1.52%)\n' +
        'Hard 4/10 **×8** (edge 11.11%) / Hard 6/8 **×10** (9.09%)',
        inline: false },
      { name: '💰 Props (ワンロール, 高エッジ)', value:
        'Field (3-11) **×2** / (2,12) **×3** (edge 2.78%)\n' +
        'Any 7 **×5** (edge 16.67%) / Any Craps **×8** (11.11%)\n' +
        'Yo 11 **×16** (11.11%)\n' +
        'Snake Eyes (2) **×31** (13.89%) / Boxcars (12) **×31** (13.89%)',
        inline: false },
      { name: '📐 Bet range', value: `**10** 〜 **50,000** ${L('chips')} (各ベット)`, inline: true },
      { name: '💳 最低入金額', value: depositLine(), inline: false },
    )
    .setFooter({ text: 'Discord C4sino · Craps Overview' });
}

export function cashierOverview(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('💵  CASHIER — 入金について')
    .setColor(0xd4af37)
    .setDescription('対応支払い方法と、入金から反映までの流れです。')
    .addFields(
      { name: '💴 PayPay (送金リンク)',
        value:
          `最低入金額: **¥${MIN_DEPOSIT_JPY.paypay.toLocaleString()}**\n` +
          'PayPay アプリで発行した送金リンクを Cashier パネルに貼り付けると、' +
          'Bot が自動で受領して即チップ加算。パスコード付きリンクも対応。',
        inline: false },
      { name: '💠 LTC (Litecoin)',
        value:
          `最低入金額: **¥${MIN_DEPOSIT_JPY.ltc.toLocaleString()}**\n` +
          '専用アドレスを発行し、送金すると 1 承認で自動チャージ。' +
          '希望 JPY 額を入力すると現在レートで必要 LTC を計算します。',
        inline: false },
      { name: '💱 レート', value: '1 JPY = 1 chip  /  LTC は CoinGecko の現在レートで JPY 換算', inline: false },
      { name: '⏱️ 反映時間',
        value: 'PayPay: 送信直後 / LTC: 約 2〜5 分 (1 承認後)',
        inline: false },
    )
    .setFooter({ text: 'Discord C4sino · Cashier Overview' });
}

export function allOverview(): EmbedBuilder {
  const s = computeSlotsRTP();
  return new EmbedBuilder()
    .setTitle('🎲 C4sino — Game Overview')
    .setColor(0xd4af37)
    .setDescription('各ゲームの概要と期待値。詳細は管理者が個別パネルを設置します。')
    .addFields(
      { name: `🂡 ${L('BLACKJACK')}`,
        value:
          '6-deck / H17 / BJ 3:2 / Split 最大4 / Double 可\n' +
          `**RTP ≈ 99.5%**  (House edge 0.5%)\n` +
          `Bet: ${MIN_BET_CHIPS.blackjack.toLocaleString()} 〜 ${MAX_BET_CHIPS.blackjack.toLocaleString()} ${L('chips')}`,
        inline: false },
      { name: `🎰 ${L('SLOTS')}`,
        value:
          '3リール / 8シンボル / 重み付き独立抽選\n' +
          `**RTP ≈ ${(s.rtp * 100).toFixed(2)}%**  (House edge ${(100 - s.rtp*100).toFixed(2)}%)\n` +
          `Max: 7️⃣×3 ×2300 / Bet: ${MIN_BET_CHIPS.slots.toLocaleString()} 〜 ${MAX_BET_CHIPS.slots.toLocaleString()} ${L('chips')}`,
        inline: false },
      { name: `🎡 ${L('ROULETTE')}`,
        value:
          'European single-zero / 37 ポケット\n' +
          '**RTP = 97.30%**  (House edge 2.70%)\n' +
          `Max: Straight-up ×36 / Bet: 10 〜 50,000 ${L('chips')}`,
        inline: false },
      { name: `🎴 ${L('BACCARAT')}`,
        value:
          'Punto Banco / Player / Banker / Tie\n' +
          '**House edge 1.06%** (Banker)\n' +
          `Max: Tie ×9 / Bet: 10 〜 50,000 ${L('chips')}`,
        inline: false },
      { name: `🃏 ${L('VIDEO POKER')}`,
        value:
          'Jacks or Better 9/6, 5-card draw\n' +
          '**RTP ≈ 99.54%** (最適プレイ時)\n' +
          `Max: Royal Flush ×800 / Bet: 10 〜 50,000 ${L('chips')}`,
        inline: false },
      { name: `🎲 ${L('CRAPS')}`,
        value:
          'マルチロール式 (Come-out → Point)\n' +
          '**Pass Line edge 1.41%**  /  Odds は 0%\n' +
          `Max: 30:1 (Snake Eyes / Boxcars) / Bet: 10 〜 50,000 ${L('chips')}`,
        inline: false },
      { name: '💳 最低入金額', value: depositLine(), inline: false },
      { name: '📒 用語',
        value:
          '**RTP** (Return to Player): 長期払戻し率。100% を下回る分がハウスの取り分。\n' +
          '**House edge**: 1 − RTP。例えば 0.5% なら ¥10,000 賭けると期待損失 ¥50。\n' +
          '**Variance**: 短期は RTP から大きくブレる。資金管理が重要。',
        inline: false },
    )
    .setFooter({ text: 'Discord C4sino · Overview' });
}

export function gameOverview(game: GameKey): EmbedBuilder {
  if (game === 'blackjack') return blackjackOverview();
  if (game === 'slots')     return slotsOverview();
  if (game === 'roulette')  return rouletteOverview();
  if (game === 'baccarat')  return baccaratOverview();
  if (game === 'videopoker') return videopokerOverview();
  if (game === 'craps')     return crapsOverview();
  if (game === 'cashier')   return cashierOverview();
  return allOverview();
}
