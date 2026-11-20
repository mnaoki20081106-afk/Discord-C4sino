import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { L } from './leet.js';
import { MIN_DEPOSIT_JPY, MIN_WITHDRAW_JPY } from '../payments/limits.js';

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

  // row1: 偶数配当系 (×2) 4 種
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('rou:bet:red').setLabel('🟥 RED').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('rou:bet:black').setLabel('⬛ BLACK').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('rou:bet:even').setLabel('EVEN').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('rou:bet:odd').setLabel('ODD').setStyle(ButtonStyle.Primary),
  );
  // row2: 上下半分 (×2) 2 種
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('rou:bet:low').setLabel('1–18 LOW').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('rou:bet:high').setLabel('19–36 HIGH').setStyle(ButtonStyle.Primary),
  );
  // row3: Dozen (×3) 3 種
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('rou:bet:dozen1').setLabel('Dozen 1–12').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('rou:bet:dozen2').setLabel('Dozen 13–24').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('rou:bet:dozen3').setLabel('Dozen 25–36').setStyle(ButtonStyle.Secondary),
  );
  // row4: Single Number (×36)
  const row4 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('rou:bet:number').setLabel('🎯 Single Number ×36').setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row1, row2, row3, row4] };
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

export function depositPanel() {
  const embed = new EmbedBuilder()
    .setTitle(`💵  ${L('CASHIER')}  💵`)
    .setDescription(`**1 ${L('chip')} = ¥1 の内部通貨**。入金で発行、出金で焼却。`)
    .setColor(0xd4af37)
    .addFields(
      { name: '📥 入金', value:
        `💴 **PayPay** 送金リンクを貼るだけで即 chip 加算 (¥${MIN_DEPOSIT_JPY.paypay}〜)\n` +
        `💠 **LTC**   アドレスを発行、1 承認で自動チャージ (¥${MIN_DEPOSIT_JPY.ltc}〜)`,
        inline: false },
      { name: '📤 出金', value:
        `💴 **PayPay** 手数料ゼロ・自動送金 (¥${MIN_WITHDRAW_JPY.paypay}〜)\n` +
        `💠 **LTC**   自分のアドレス指定・ネットワーク手数料あり (¥${MIN_WITHDRAW_JPY.ltc}〜)`,
        inline: false },
      { name: L('Rate'), value: `LTC は CoinGecko の現在レートで JPY 換算`, inline: false },
    )
    .setFooter({ text: 'Discord C4sino · Cashier' });

  const depSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('dep:method')
      .setPlaceholder('📥 入金方法を選択…')
      .addOptions(
        { label: 'PayPay 送金リンクで入金', value: 'paypay', description: '送金リンク URL / ID を貼り付け', emoji: '💴' },
        { label: 'LTC で入金',               value: 'ltc',    description: '専用アドレスを発行、送金後に自動チャージ', emoji: '💠' },
      )
  );
  const wdSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('wd:method')
      .setPlaceholder('📤 出金方法を選択…')
      .addOptions(
        { label: 'PayPay で出金', value: 'paypay', description: '送金リンクを DM で受取 (手数料無料)', emoji: '💴' },
        { label: 'LTC で出金',    value: 'ltc',    description: '任意の LTC アドレスへ送金 (手数料あり)', emoji: '💠' },
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
