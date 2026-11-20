import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

export function blackjackPanel() {
  const embed = new EmbedBuilder()
    .setTitle('🂡  BL4CKJ4CK T4BL3  🂱')
    .setDescription('高級テーブルへようこそ。ベット額を選んで着席してください。\n**P4ys 3:2 — D34l3r h1ts s0ft 17**')
    .setColor(0x0d5a3a)
    .addFields(
      { name: 'M1n / M4x', value: '`10` / `50,000` ch1ps', inline: true },
      { name: 'D3ck', value: '`6 d3cks sh03`', inline: true },
    )
    .setFooter({ text: 'D1sc0rd C4s1n0 · T4bl3 BJ-01' });

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('bj:bet:100').setLabel('B3T 100').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('bj:bet:500').setLabel('B3T 500').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('bj:bet:1000').setLabel('B3T 1,000').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('bj:bet:5000').setLabel('B3T 5,000').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('bj:bet:custom').setLabel('CU5T0M').setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row1] };
}

export function slotsPanel() {
  const embed = new EmbedBuilder()
    .setTitle('🎰  C4S1N0 5L0T5  🎰')
    .setDescription('3リール・8シンボル。7️⃣ 揃いで **x1000**！')
    .setColor(0x2d0a4e)
    .addFields(
      { name: 'P4ys', value: '🍒🍒🍒 x5 · 🍋🍋🍋 x8 · 🍊🍊🍊 x12 · 🍉🍉🍉 x20\n⭐⭐⭐ x40 · 🔔🔔🔔 x80 · 💎💎💎 x200 · 7️⃣7️⃣7️⃣ **x1000**', inline: false },
      { name: 'S1d3', value: '🍒🍒? **x1**', inline: true },
    )
    .setFooter({ text: 'D1sc0rd C4s1n0 · Sl0t A-01' });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('slot:spin:50').setLabel('SP1N 50').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('slot:spin:100').setLabel('SP1N 100').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('slot:spin:500').setLabel('SP1N 500').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('slot:spin:1000').setLabel('SP1N 1,000').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('slot:spin:custom').setLabel('CU5T0M').setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row] };
}

export function depositPanel() {
  const embed = new EmbedBuilder()
    .setTitle('💵  C45H13R  💵')
    .setDescription('PayPay 送金リンク、または LTC を送金してチップを取得します。')
    .setColor(0xd4af37)
    .addFields(
      { name: 'PayPay', value: '送金後、下のボタンから送金リンクを提出してください（管理者承認）。', inline: false },
      { name: 'LTC', value: '専用アドレスを発行し、入金確認で自動チャージ。', inline: false },
      { name: 'R4t3', value: '1 JPY = 1 ch1p', inline: true },
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
    hit:   { label: 'H1T',    style: ButtonStyle.Primary },
    stand: { label: '5T4ND',  style: ButtonStyle.Secondary },
    double:{ label: 'D0UBL3', style: ButtonStyle.Danger },
    split: { label: 'SPL1T',  style: ButtonStyle.Success },
  };
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const a of actions) {
    const m = map[a];
    row.addComponents(new ButtonBuilder().setCustomId(`bj:act:${a}`).setLabel(m.label).setStyle(m.style));
  }
  return row;
}
