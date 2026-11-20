import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { L } from './leet.js';

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
    .setDescription('3リール・8シンボル。7️⃣ 揃いで **x1000**！')
    .setColor(0x2d0a4e)
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
        '🟥 Red / ⬛ Black / Odd / Even / 1–18 / 19–36 ... **×2**\n' +
        '1st12 / 2nd12 / 3rd12 / Col1 / Col2 / Col3 ... **×3**\n' +
        'Straight-up (単一数字) ... **×36**',
        inline: false },
      { name: L('Bet'), value: `10 〜 50,000 ${L('chips')}`, inline: true },
      { name: 'RTP',   value: '≈ 97.30%', inline: true },
    )
    .setFooter({ text: 'Discord C4sino · Roulette Table' });

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('rou:bet:red').setLabel('🟥 RED').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('rou:bet:black').setLabel('⬛ BLACK').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('rou:bet:odd').setLabel('ODD').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('rou:bet:even').setLabel('EVEN').setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('rou:bet:low').setLabel('1–18').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('rou:bet:high').setLabel('19–36').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('rou:bet:dozen1').setLabel('1st12').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('rou:bet:dozen2').setLabel('2nd12').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('rou:bet:dozen3').setLabel('3rd12').setStyle(ButtonStyle.Secondary),
  );
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('rou:bet:column1').setLabel('Col1').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('rou:bet:column2').setLabel('Col2').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('rou:bet:column3').setLabel('Col3').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('rou:bet:number').setLabel('🎯 Straight (×36)').setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row1, row2, row3] };
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
    .setColor(0x2d0a4e)
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

export function depositPanel() {
  const embed = new EmbedBuilder()
    .setTitle(`💵  ${L('CASHIER')}  💵`)
    .setDescription('**支払い方法を選択してください。**\n選んだ方法でチップを購入できます。')
    .setColor(0xd4af37)
    .addFields(
      { name: '💴 PayPay', value: '送金リンクを貼るだけで即チップに変換（自動受領）', inline: false },
      { name: '💠 LTC',    value: '専用アドレスを発行、1承認で自動チャージ', inline: false },
      { name: L('Rate'),   value: `1 JPY = 1 ${L('chip')}  /  LTC は CoinGecko レートで JPY 換算`, inline: false },
    )
    .setFooter({ text: 'Discord C4sino · Cashier' });

  const select = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('dep:method')
      .setPlaceholder('🔽 支払い方法を選択…')
      .addOptions(
        { label: 'PayPay 送金リンクで入金', value: 'paypay', description: '送金リンク URL / ID を貼り付け', emoji: '💴' },
        { label: 'LTC で入金',               value: 'ltc',    description: '専用アドレスを発行、送金後に自動チャージ', emoji: '💠' },
      )
  );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('dep:paypay').setLabel('PayPay').setEmoji('💴').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('dep:ltc').setLabel('LTC').setEmoji('💠').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('bal').setLabel('残高確認').setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [select, row] };
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
