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
      { name: L('Pays'), value: `🍒🍒🍒 x5 · 🍋🍋🍋 x8 · 🍊🍊🍊 x12 · 🍉🍉🍉 x20\n⭐⭐⭐ x40 · 🔔🔔🔔 x80 · 💎💎💎 x200 · 7️⃣7️⃣7️⃣ **x1000**`, inline: false },
      { name: L('Side'), value: '🍒🍒? **x1**', inline: true },
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
