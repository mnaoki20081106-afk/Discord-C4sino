import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { L } from './leet.js';
import { MIN_DEPOSIT_JPY, MIN_WITHDRAW_JPY } from '../payments/limits.js';
import { renderBalance } from './render-balance.js';

export function blackjackPanel() {
  const embed = new EmbedBuilder()
    .setTitle(`🂡  ${L('BLACKJACK')} ${L('TABLE')}  🂱`)
    .setDescription(`高級テーブルへようこそ。ベット額を選んで着席してください。\n**${L('Pays')} 3:2 — ${L('Dealer')} ${L('hits')} ${L('soft')} 17**`)
    .setColor(0x0d5a3a)
    .addFields(
      { name: `${L('Min')} / ${L('Max')}`, value: `\`10\` / \`50,000\` ${L('chips')}`, inline: true },
      { name: L('Deck'), value: `\`6 ${L('decks')} ${L('shoe')}\``, inline: true },
    )
    .setFooter({ text: `Discord C4sino · ${L('Table')} BJ-01` });

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('bj:bet:100').setLabel(`${L('BET')} 100`).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('bj:bet:500').setLabel(`${L('BET')} 500`).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('bj:bet:1000').setLabel(`${L('BET')} 1,000`).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('bj:bet:5000').setLabel(`${L('BET')} 5,000`).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('bj:bet:custom').setLabel(L('CUSTOM')).setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row1] };
}

export function slotsPanel() {
  const embed = new EmbedBuilder()
    .setTitle(`🎰  ${L('C4SINO')} ${L('SLOTS')}  🎰`)
    .setDescription('3リール・8シンボル。7️⃣ 揃いで **x2300**！')
    .setColor(0x7f1d1d)
    .addFields(
      { name: L('Pays'), value: `🍒🍒🍒 x12 · 🍋🍋🍋 x18 · 🍊🍊🍊 x28 · 🍉🍉🍉 x46\n⭐⭐⭐ x92 · 🔔🔔🔔 x184 · 💎💎💎 x460 · 7️⃣7️⃣7️⃣ **x2300**`, inline: false },
      { name: L('Side'), value: '🍒🍒? **x2**', inline: true },
      { name: 'RTP',    value: '≈ 95%', inline: true },
    )
    .setFooter({ text: `Discord C4sino · ${L('Slot')} A-01` });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('slot:spin:50').setLabel(`${L('SPIN')} 50`).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('slot:spin:100').setLabel(`${L('SPIN')} 100`).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('slot:spin:500').setLabel(`${L('SPIN')} 500`).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('slot:spin:1000').setLabel(`${L('SPIN')} 1,000`).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('slot:spin:custom').setLabel(L('CUSTOM')).setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row] };
}

export function roulettePanel() {
  const embed = new EmbedBuilder()
    .setTitle(`🎡  ${L('EUROPEAN')} ${L('ROULETTE')}  🎡`)
    .setDescription('シングルゼロ (0 のみ) のヨーロピアン・ルーレット。House edge **2.70%**。')
    .setColor(0x0d5a3a)
    .addFields(
      { name: L('Pays'), value:
        '🟥 Red / ⬛ Black / Odd / Even / 1–18 Low / 19–36 High ... **×2**\n' +
        'Dozen 1–12 / 13–24 / 25–36 ... **×3**\n' +
        'Single Number (0〜36) ... **×36**',
        inline: false },
      { name: L('Bet'), value: `10 〜 50,000 ${L('chips')}`, inline: true },
      { name: 'RTP',   value: '≈ 97.30%', inline: true },
    )
    .setFooter({ text: 'Discord C4sino · Roulette Table' });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('rou:start').setLabel('🎡 PLAY').setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row] };
}

/** パネル押下後に出すベット種類の SelectMenu (ephemeral) */
export function rouletteBetSelectRow() {
  const sel = new StringSelectMenuBuilder()
    .setCustomId('rou:select')
    .setPlaceholder('🔽 ベットタイプを選択…')
    .addOptions(
      new StringSelectMenuOptionBuilder().setValue('red').setLabel('🟥 Red (×2)').setDescription('赤の数字 — 18/37'),
      new StringSelectMenuOptionBuilder().setValue('black').setLabel('⬛ Black (×2)').setDescription('黒の数字 — 18/37'),
      new StringSelectMenuOptionBuilder().setValue('even').setLabel('Even (×2)').setDescription('偶数 (0 除く) — 18/37'),
      new StringSelectMenuOptionBuilder().setValue('odd').setLabel('Odd (×2)').setDescription('奇数 — 18/37'),
      new StringSelectMenuOptionBuilder().setValue('low').setLabel('1–18 Low (×2)').setDescription('下半分 — 18/37'),
      new StringSelectMenuOptionBuilder().setValue('high').setLabel('19–36 High (×2)').setDescription('上半分 — 18/37'),
      new StringSelectMenuOptionBuilder().setValue('dozen1').setLabel('Dozen 1–12 (×3)').setDescription('第 1 ダース — 12/37'),
      new StringSelectMenuOptionBuilder().setValue('dozen2').setLabel('Dozen 13–24 (×3)').setDescription('第 2 ダース — 12/37'),
      new StringSelectMenuOptionBuilder().setValue('dozen3').setLabel('Dozen 25–36 (×3)').setDescription('第 3 ダース — 12/37'),
      new StringSelectMenuOptionBuilder().setValue('number').setLabel('🎯 Single Number (×36)').setDescription('単一数字 0〜36 — 1/37'),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(sel);
}

export function baccaratPanel() {
  const embed = new EmbedBuilder()
    .setTitle(`🎴  ${L('BACCARAT')}  🎴`)
    .setDescription('Punto Banco ルール。3 つのベット対象から選んで配牌結果を競う。')
    .setColor(0x0d5a3a)
    .addFields(
      { name: L('Pays'), value:
        `${L('Player')}: **×2.0**  (House edge 1.24%)\n` +
        `${L('Banker')}: **×1.95**  (5% コミ・House edge 1.06%)\n` +
        `${L('Tie')}: **×9.0**  (House edge 14.4%)`,
        inline: false },
      { name: L('Bet'), value: `10 〜 50,000 ${L('chips')}`, inline: true },
    )
    .setFooter({ text: 'Discord C4sino · Baccarat' });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('bac:side:player').setLabel('👤 PLAYER ×2').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('bac:side:banker').setLabel('🏦 BANKER ×1.95').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('bac:side:tie').setLabel('🤝 TIE ×9').setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row] };
}

export function videopokerPanel() {
  const embed = new EmbedBuilder()
    .setTitle(`🃏  ${L('VIDEO POKER')} — ${L('JACKS OR BETTER')}  🃏`)
    .setDescription('5 枚の手札を見て、残したいカードを HOLD、[DRAW] で引き直し。役を作って勝利。')
    .setColor(0x1e293b)
    .addFields(
      { name: L('Pays'), value:
        '`Royal Flush  ×800` · `Straight Flush  ×50` · `Four of a Kind  ×25`\n' +
        '`Full House   ×9`  · `Flush          ×6`  · `Straight       ×4`\n' +
        '`3 of a Kind  ×3`  · `Two Pair       ×2`  · `Jacks or Better ×1`',
        inline: false },
      { name: 'RTP', value: '≈ 99.54% (9/6 Jacks, 最適プレイ時)', inline: true },
    )
    .setFooter({ text: 'Discord C4sino · Video Poker' });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('vp:deal:100').setLabel(`DEAL 100`).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vp:deal:500').setLabel(`DEAL 500`).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('vp:deal:1000').setLabel(`DEAL 1,000`).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('vp:deal:5000').setLabel(`DEAL 5,000`).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('vp:deal:custom').setLabel('CUSTOM').setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row] };
}

export function vpHoldRow(held: boolean[]): ActionRowBuilder<ButtonBuilder>[] {
  const row1 = new ActionRowBuilder<ButtonBuilder>();
  for (let i = 0; i < 5; i++) {
    row1.addComponents(new ButtonBuilder()
      .setCustomId(`vp:hold:${i}`)
      .setLabel(`${i+1} ${held[i] ? 'HELD' : 'HOLD'}`)
      .setStyle(held[i] ? ButtonStyle.Success : ButtonStyle.Secondary));
  }
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('vp:draw').setLabel('🎴 DRAW').setStyle(ButtonStyle.Primary),
  );
  return [row1, row2];
}

/** Craps 設置用パネル (入口) */
export function crapsPanel() {
  const embed = new EmbedBuilder()
    .setTitle(`🎲  ${L('CRAPS')}  🎲`)
    .setDescription(
      '定番のダイスゲーム。Pass / Don\'t Pass から Hardways / Props まで 25 種類のベット。\n' +
      '「🎲 START」でセッション開始、ephemeral で進行します。'
    )
    .setColor(0x0d5a3a)
    .addFields(
      { name: 'Pays (抜粋)', value:
        'Pass / Don\'t Pass / Come / Don\'t Come  **×2**\n' +
        'Field (3,4,9,10,11)  **×2**  /  (2,12)  **×3**\n' +
        'Place 4/10 **×2.8**  /  5/9 **×2.4**  /  6/8 **×2.17**\n' +
        'Hard 4/10 **×8**  /  6/8 **×10**\n' +
        'Any 7 **×5**  /  Any Craps **×8**  /  Yo **×16**\n' +
        'Snake Eyes (2) / Boxcars (12)  **×31**',
        inline: false },
      { name: 'House edge', value: 'Pass **1.41%** / Don\'t Pass **1.36%** / Pass Odds **0%** / Prop 11–17%', inline: false },
    )
    .setFooter({ text: 'Discord C4sino · Craps Table' });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('cr:start').setLabel('🎲 START').setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row] };
}

/** Craps 進行中: ベット選択 (SelectMenu) + ROLL / END */
export function crapsControlRows(state: { phase: 'comeout'|'point'; point?: number; betCount: number }) {
  const opts = [
    ['pass',       'Pass Line (×2) — comeout 推奨'],
    ['dontpass',   "Don't Pass (×2) — 逆張り"],
    ['pass_odds',  'Pass Odds (×2.2-3) — ポイント必須, no edge'],
    ['dontpass_odds', "Don't Pass Odds — 要ポイント, no edge"],
    ['come',       'Come (×2) — ポイント中のみ'],
    ['dontcome',   "Don't Come — ポイント中のみ"],
    ['field',      'Field (×2 / ×3) — ワンロール'],
    ['place4',     'Place 4 (×2.8)'],
    ['place5',     'Place 5 (×2.4)'],
    ['place6',     'Place 6 (×2.17)'],
    ['place8',     'Place 8 (×2.17)'],
    ['place9',     'Place 9 (×2.4)'],
    ['place10',    'Place 10 (×2.8)'],
    ['hard4',      'Hard 4 (×8)'],
    ['hard6',      'Hard 6 (×10)'],
    ['hard8',      'Hard 8 (×10)'],
    ['hard10',     'Hard 10 (×8)'],
    ['big6',       'Big 6 (×2)'],
    ['big8',       'Big 8 (×2)'],
    ['any7',       'Any 7 (×5) — ワンロール'],
    ['anycraps',   'Any Craps (×8) — ワンロール'],
    ['yo11',       'Yo 11 (×16) — ワンロール'],
    ['snakeeyes',  'Snake Eyes 2 (×31) — ワンロール'],
    ['acedeuce',   'Ace-Deuce 3 (×16) — ワンロール'],
    ['boxcars',    'Boxcars 12 (×31) — ワンロール'],
  ] as const;
  const select = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId('cr:add').setPlaceholder('🔽 ベットタイプを選択…')
      .addOptions(opts.map(([v, l]) => new StringSelectMenuOptionBuilder().setValue(v).setLabel(l.slice(0, 100))))
  );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('cr:roll').setLabel('🎲 ROLL').setStyle(ButtonStyle.Primary).setDisabled(state.betCount === 0),
    new ButtonBuilder().setCustomId('cr:undo').setLabel('↩ 直前のベット取消').setStyle(ButtonStyle.Secondary).setDisabled(state.betCount === 0),
    new ButtonBuilder().setCustomId('cr:end').setLabel('END').setStyle(ButtonStyle.Danger),
  );
  return [select, row];
}

/* ────────────── Per-game Play panels (mix bet 対応) ────────────── */

export function bjPlayPanel() {
  const embed = new EmbedBuilder()
    .setTitle(L('BLACKJACK'))
    .setColor(0x0d5a3a)
    .setDescription(
      '6 デッキシューで Dealer soft 17 Hit (H17)、Blackjack 配当 **3:2**。\n' +
      'Double / Split (最大 4 ハンド) 対応。'
    )
    .addFields(
      { name: 'ルール', value:
        '・Blackjack (A + 10 点札) で即勝ち 3:2\n' +
        '・Dealer は 17 以上まで Hit (soft 17 も Hit)\n' +
        '・Split した A は 1 枚ずつのみ Hit 可\n' +
        '・Double は最初の 2 枚のみ',
        inline: false },
      { name: '最小 / 最大 BET', value: '`10` / `50,000` chips', inline: true },
      { name: 'ハウスエッジ', value: '約 0.6%', inline: true },
    )
    .setFooter({ text: 'Play を押して BET 額を入力' });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('play:blackjack').setLabel('Play').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('bal').setLabel('残高確認').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

export function slotsPlayPanel() {
  const embed = new EmbedBuilder()
    .setTitle(L('SLOTS'))
    .setColor(0x7c2d12)
    .setDescription(
      '3 リール 8 シンボルの古典型スロット。各リールが独立に停止します。'
    )
    .addFields(
      { name: '配当', value:
        '・3-of-a-kind: シンボル固有倍率 (5x〜200x)\n' +
        '・2 連 🍒: 2x サイド配当',
        inline: false },
      { name: '最小 / 最大 BET', value: '`10` / `25,000` chips', inline: true },
      { name: 'RTP (目安)', value: '94〜96%', inline: true },
    )
    .setFooter({ text: 'Play を押して BET 額を入力' });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('play:slots').setLabel('Play').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('bal').setLabel('残高確認').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

export function vpPlayPanel() {
  const embed = new EmbedBuilder()
    .setTitle(L('VIDEO POKER'))
    .setColor(0x1e3a8a)
    .setDescription(
      'Jacks or Better 9/6 配当表。最初に 5 枚配られ、Hold したいカードを選んで Draw。'
    )
    .addFields(
      { name: '配当 (BET=1 基準)', value:
        'Royal 800 / Straight Flush 50 / 4-of-a-kind 25\n' +
        'Full House 9 / Flush 6 / Straight 4 / 3-of-a-kind 3\n' +
        'Two Pair 2 / Jacks or Better 1',
        inline: false },
      { name: '最小 / 最大 BET', value: '`10` / `10,000` chips', inline: true },
      { name: 'RTP (完璧プレイ)', value: '約 99.5%', inline: true },
    )
    .setFooter({ text: 'Play を押して BET 額を入力' });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('play:videopoker').setLabel('Play').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('bal').setLabel('残高確認').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

export function roulettePlayPanel() {
  const embed = new EmbedBuilder()
    .setTitle(L('ROULETTE'))
    .setColor(0x991b1b)
    .setDescription(
      'シングルゼロ (ヨーロピアン)。賭け方を選んで BET 額を入力してください。'
    )
    .addFields(
      { name: '配当', value:
        '・Straight (1 数字) **35:1**\n' +
        '・Red / Black / Odd / Even / Low / High **1:1**\n' +
        '・Dozen / Column **2:1**',
        inline: false },
      { name: '最小 / 最大 BET', value: '`10` / `20,000` chips', inline: true },
      { name: 'ハウスエッジ', value: '2.70% (0 の一枠)', inline: true },
    )
    .setFooter({ text: '賭け方を押して BET 額を入力' });
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('play:roulette:red').setLabel('Red').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('play:roulette:black').setLabel('Black').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('play:roulette:odd').setLabel('Odd').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('play:roulette:even').setLabel('Even').setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('play:roulette:low').setLabel('1-18').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('play:roulette:high').setLabel('19-36').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('play:roulette:straight').setLabel('Number (0-36)').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('bal').setLabel('残高確認').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row1, row2] };
}

export function baccaratPlayPanel() {
  const embed = new EmbedBuilder()
    .setTitle(L('BACCARAT'))
    .setColor(0x065f46)
    .setDescription(
      '8 デッキ、標準的な Baccarat ルール (Punto Banco)。'
    )
    .addFields(
      { name: '配当', value:
        '・Player 勝ち **1:1**\n' +
        '・Banker 勝ち **1:0.95** (5% コミッション)\n' +
        '・Tie **8:1**',
        inline: false },
      { name: '最小 / 最大 BET', value: '`10` / `30,000` chips', inline: true },
      { name: 'ハウスエッジ', value: 'Banker 1.06% / Player 1.24% / Tie 14.4%', inline: true },
    )
    .setFooter({ text: '賭け先を押して BET 額を入力' });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('play:baccarat:player').setLabel('Player').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('play:baccarat:banker').setLabel('Banker').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('play:baccarat:tie').setLabel('Tie').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('bal').setLabel('残高確認').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

export function crapsPlayPanel() {
  const embed = new EmbedBuilder()
    .setTitle(L('CRAPS'))
    .setColor(0xb45309)
    .setDescription(
      '2 ダイスで Point / Come-out を解決。複数 BET をテーブルに置いて同時解決します。\n' +
      '**mix BET が複雑なため、従来の `/setup game:craps` パネルから開始してください。**'
    )
    .setFooter({ text: 'Craps は近日 mix bet 対応予定' });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('bal').setLabel('残高確認').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

/**
 * 残高カード (画像 embed)。/balance と Cashier パネルの残高確認で使用。
 * 返り値をそのまま interaction.reply に展開できる形で返す。
 */
export async function balanceReply(pp: number, ltc: number, note?: string) {
  const png = await renderBalance({ pp, ltc, note });
  const file = new AttachmentBuilder(png, { name: 'balance.png' });
  const embed = new EmbedBuilder()
    .setColor(0xd4af37)
    .setImage('attachment://balance.png')
    .setFooter({ text: '入金したレール分だけ、そのレールで出金できます' });
  return { embeds: [embed], files: [file] };
}

export function depositPanel() {
  const embed = new EmbedBuilder()
    .setTitle(`${L('CASHIER')}`)
    .setDescription(
      `**1 ${L('chip')} = ¥1 の内部通貨**。入金で発行、出金で焼却。\n` +
      `残高は **PayPay 由来** と **LTC 由来** に分かれて管理されます。\n` +
      `**出金は入金したレール分が上限** — PayPay で入れた分は PayPay から、LTC で入れた分は LTC から。\n` +
      `残高確認ボタンで自分のゲージを表示できます。`
    )
    .setColor(0xd4af37)
    .addFields(
      { name: '入金', value:
        `**PayPay** 送金リンクを貼るだけで即 chip 加算 (¥${MIN_DEPOSIT_JPY.paypay}〜) — PayPay 側に加算\n` +
        `**LTC**    アドレスを発行、1 承認で自動チャージ (¥${MIN_DEPOSIT_JPY.ltc}〜) — LTC 側に加算`,
        inline: false },
      { name: '出金', value:
        `**PayPay** 手数料ゼロ・自動送金 (¥${MIN_WITHDRAW_JPY.paypay}〜 / PayPay 由来の範囲)\n` +
        `**LTC**    任意アドレス指定・ネットワーク手数料あり (¥${MIN_WITHDRAW_JPY.ltc}〜 / LTC 由来の範囲)`,
        inline: false },
      { name: L('Rate'), value: `LTC は CoinGecko の現在レートで JPY 換算`, inline: false },
    )
    .setFooter({ text: 'Discord C4sino · Cashier' });

  const depSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('dep:method')
      .setPlaceholder('入金方法を選択…')
      .addOptions(
        { label: 'PayPay 送金リンクで入金', value: 'paypay', description: '送金リンク URL / ID を貼り付け' },
        { label: 'LTC で入金',               value: 'ltc',    description: '専用アドレスを発行、送金後に自動チャージ' },
      )
  );
  const wdSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('wd:method')
      .setPlaceholder('出金方法を選択…')
      .addOptions(
        { label: 'PayPay で出金', value: 'paypay', description: '送金リンクを DM で受取 (手数料無料)' },
        { label: 'LTC で出金',    value: 'ltc',    description: '任意の LTC アドレスへ送金 (手数料あり)' },
      )
  );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('bal').setLabel('残高確認').setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [depSelect, wdSelect, row] };
}

export function bjActionsRow(actions: string[]): ActionRowBuilder<ButtonBuilder> {
  const map: Record<string, { label: string; style: ButtonStyle }> = {
    hit:   { label: L('HIT'),    style: ButtonStyle.Primary },
    stand: { label: L('STAND'),  style: ButtonStyle.Secondary },
    double:{ label: L('DOUBLE'), style: ButtonStyle.Danger },
    split: { label: L('SPLIT'),  style: ButtonStyle.Success },
  };
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const a of actions) {
    const m = map[a];
    row.addComponents(new ButtonBuilder().setCustomId(`bj:act:${a}`).setLabel(m.label).setStyle(m.style));
  }
  return row;
}
