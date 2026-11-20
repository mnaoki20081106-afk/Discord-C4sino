import { EmbedBuilder } from 'discord.js';
import { SYMBOLS } from '../games/slots.js';
import { L } from './leet.js';

export type GameKey = 'blackjack' | 'slots' | 'all';

/** スロットの実 RTP を重みから計算 */
export function computeSlotsRTP() {
  const total = SYMBOLS.reduce((s, x) => s + x.w, 0);
  const p: Record<string, number> = {};
  for (const s of SYMBOLS) p[s.id] = s.w / total;

  // 3-of-a-kind
  let rtp3 = 0;
  const lines3: Array<{ sym: string; prob: number; pay: number; ret: number }> = [];
  for (const s of SYMBOLS) {
    const prob = p[s.id] ** 3;
    const ret = prob * s.pay3;
    rtp3 += ret;
    lines3.push({ sym: s.id, prob, pay: s.pay3, ret });
  }

  // 2-cherry (1,2 位置限定、3位置目は非チェリー=3-of-a-kindに非該当)
  const pc = p['🍒'];
  const cherry = SYMBOLS[0]; // index 0 = 🍒
  const prob2c = pc * pc * (1 - pc);
  const ret2c = prob2c * cherry.pay2;
  const rtp = rtp3 + ret2c;

  return { rtp, rtp3, ret2c, prob2c, lines3, totalWeight: total };
}

export function blackjackOverview(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`🂡  ${L('BLACKJACK')} — ${L('OVERVIEW')}`)
    .setColor(0x0d5a3a)
    .setDescription(
      '伝統的なラスベガスルールのブラックジャック。6デッキシュー、暗号学的乱数で毎局シャッフル。'
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
        '`Blackjack`  × **2.5** (bet含む / 純利 +1.5x)\n' +
        '`Win`         × **2.0** (純利 +1x)\n' +
        '`Push`        × **1.0** (bet 返却)\n' +
        '`Lose`        × **0** ',
        inline: false },
      { name: '📊 RTP / House edge', value:
        '参考値 (6-deck, H17, DAS, no surrender, BJ 3:2):\n' +
        '**RTP ≈ 99.5%**  /  **House edge ≈ 0.5%**\n' +
        'ベーシックストラテジー通りに打った場合。',
        inline: false },
      { name: '📐 Bet range', value: '`10` 〜 `50,000` chips', inline: true },
      { name: '🎰 Min/round', value: '1 ゲーム 10 秒〜', inline: true },
      { name: '💡 Tips', value:
        '• ソフトハンドは強気に hit\n' +
        '• ディーラーアップカード 2–6 なら保守的に stand\n' +
        '• 8, A は必ず split、10 や 5 は絶対に split しない',
        inline: false },
    )
    .setFooter({ text: 'RTP は長期的な期待値であり、短期の結果は分散で揺らぎます。' });
}

export function slotsOverview(): EmbedBuilder {
  const r = computeSlotsRTP();
  const pct = (x: number) => `${(x * 100).toFixed(4)}%`;
  const cents = (x: number) => `${(x * 100).toFixed(2)}%`;

  const lines = r.lines3
    .sort((a, b) => b.pay - a.pay)
    .map(l => `\`${l.sym}×3\` — pay **×${l.pay}**  p=${pct(l.prob)}  → 寄与 ${cents(l.ret)}`)
    .join('\n');

  const sumWinProb = r.lines3.reduce((s, l) => s + l.prob, 0) + r.prob2c;
  const hitFreq = 1 / sumWinProb;

  return new EmbedBuilder()
    .setTitle(`🎰  ${L('SLOTS')} — ${L('OVERVIEW')}`)
    .setColor(0x2d0a4e)
    .setDescription(
      '3リール・8シンボルのクラシックスロット。各リールは独立に重み付き抽選。'
    )
    .addFields(
      { name: '💎 Payouts (3-of-a-kind)', value: lines, inline: false },
      { name: '🍒 Side line', value:
        `\`🍒🍒?\` (左2つがチェリー) — pay **×${SYMBOLS[0].pay2}**  p=${pct(r.prob2c)}  → 寄与 ${cents(r.ret2c)}`,
        inline: false },
      { name: '📊 RTP', value:
        `**RTP = ${(r.rtp * 100).toFixed(2)}%**  (House edge ${(100 - r.rtp*100).toFixed(2)}%)\n` +
        `うち 3-of-a-kind: ${(r.rtp3 * 100).toFixed(2)}%  /  2-cherry: ${(r.ret2c * 100).toFixed(2)}%`,
        inline: false },
      { name: '🎯 Hit frequency', value:
        `約 **${hitFreq.toFixed(1)} 回に 1 回** 当たり\n` +
        `(どれかの配当が出る確率 = ${(sumWinProb*100).toFixed(2)}%)`,
        inline: true },
      { name: '📐 Bet range', value: '`10` 〜 `10,000` chips', inline: true },
      { name: '💡 Note', value:
        'ジャックポット `7️⃣×3` は確率 ' + pct((SYMBOLS[7].w/r.totalWeight)**3) +
        '（約 ' + Math.round(1 / ((SYMBOLS[7].w/r.totalWeight)**3)).toLocaleString() + ' 回に1回）、\n' +
        '配当 ×1000。',
        inline: false },
    )
    .setFooter({ text: 'RTP は無限試行時の期待値。分散のため短期結果は大きく揺らぎます。' });
}

export function allOverview(): EmbedBuilder {
  const s = computeSlotsRTP();
  return new EmbedBuilder()
    .setTitle('🎲 C4sino — Game Overview')
    .setColor(0xd4af37)
    .setDescription('各ゲームの概要と期待値。詳細は `/overview game:<name>` で。')
    .addFields(
      { name: `🂡 ${L('BLACKJACK')}`, value:
        '6-deck / H17 / BJ 3:2 / Split 最大4 / Double 可\n' +
        '**RTP ≈ 99.5%**  House edge ≈ 0.5%  (BS通り)\n' +
        'Bet: 10 〜 50,000',
        inline: false },
      { name: `🎰 ${L('SLOTS')}`, value:
        '3リール / 8シンボル / 重み付き独立抽選\n' +
        `**RTP ≈ ${(s.rtp * 100).toFixed(2)}%**  House edge ≈ ${(100 - s.rtp*100).toFixed(2)}%\n` +
        'Max: 7️⃣×3 で ×1000 / Bet: 10 〜 10,000',
        inline: false },
      { name: '📒 用語', value:
        '**RTP** (Return to Player): 長期の払戻し率。100% を下回る分がハウスの取り分。\n' +
        '**House edge**: 1 - RTP。例えば 0.5% なら ¥10,000 賭けると期待損失 ¥50。\n' +
        '**Variance**: 短期は RTP から大きくブレる。資金管理が重要。',
        inline: false },
    )
    .setFooter({ text: '表示値は実装の確率から計算 / BJは標準ルール参考値' });
}

export function gameOverview(game: GameKey): EmbedBuilder {
  if (game === 'blackjack') return blackjackOverview();
  if (game === 'slots')     return slotsOverview();
  return allOverview();
}
