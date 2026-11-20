import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

export function blackjackPanel() {
  const embed = new EmbedBuilder()
    .setTitle('🂡  BLACKJACK TABLE  🂱')
    .setDescription('高級テーブルへようこそ。ベット額を選んで着席してください。\n**Pays 3:2 — Dealer hits soft 17**')
    .setColor(0x0d5a3a)
    .addFields(
      { name: 'Min / Max', value: '`10` / `50,000` chips', inline: true },
      { name: 'Deck', value: '`6 decks shoe`', inline: true },
    )
    .setFooter({ text: 'Discord C4sino · Table BJ-01' });

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('bj:bet:100').setLabel('BET 100').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('bj:bet:500').setLabel('BET 500').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('bj:bet:1000').setLabel('BET 1,000').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('bj:bet:5000').setLabel('BET 5,000').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('bj:bet:custom').setLabel('CUSTOM').setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row1] };
}

export function slotsPanel() {
  const embed = new EmbedBuilder()
    .setTitle('🎰  C4SINO SLOTS  🎰')
    .setDescription('3リール・8シンボル。7️⃣ 揃いで **x1000**！')
    .setColor(0x2d0a4e)
    .addFields(
      { name: 'Pays', value: '🍒🍒🍒 x5 · 🍋🍋🍋 x8 · 🍊🍊🍊 x12 · 🍉🍉🍉 x20\n⭐⭐⭐ x40 · 🔔🔔🔔 x80 · 💎💎💎 x200 · 7️⃣7️⃣7️⃣ **x1000**', inline: false },
      { name: 'Side', value: '🍒🍒? **x1**', inline: true },
    )
    .setFooter({ text: 'Discord C4sino · Slot A-01' });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('slot:spin:50').setLabel('SPIN 50').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('slot:spin:100').setLabel('SPIN 100').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('slot:spin:500').setLabel('SPIN 500').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('slot:spin:1000').setLabel('SPIN 1,000').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('slot:spin:custom').setLabel('CUSTOM').setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row] };
}

export function depositPanel() {
  const embed = new EmbedBuilder()
    .setTitle('💵  CASHIER  💵')
    .setDescription('PayPay 送金リンク、または LTC を送金してチップを取得します。')
    .setColor(0xd4af37)
    .addFields(
      { name: 'PayPay', value: '送金後、下のボタンから送金リンクを提出してください（管理者承認）。', inline: false },
      { name: 'LTC', value: '専用アドレスを発行し、入金確認で自動チャージ。', inline: false },
      { name: 'Rate', value: '1 JPY = 1 chip', inline: true },
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('dep:paypay').setLabel('PayPay 送金リンク提出').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('dep:ltc').setLabel('LTC 入金アドレス取得').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('bal').setLabel('残高確認').setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row] };
}

export function bjActionsRow(actions: string[]): ActionRowBuilder<ButtonBuilder> {
  const map: Record<string, { label: string; style: ButtonStyle }> = {
    hit:   { label: 'HIT',    style: ButtonStyle.Primary },
    stand: { label: 'STAND',  style: ButtonStyle.Secondary },
    double:{ label: 'DOUBLE', style: ButtonStyle.Danger },
    split: { label: 'SPLIT',  style: ButtonStyle.Success },
  };
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const a of actions) {
    const m = map[a];
    row.addComponents(new ButtonBuilder().setCustomId(`bj:act:${a}`).setLabel(m.label).setStyle(m.style));
  }
  return row;
}
