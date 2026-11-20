// PayPay 入金は公式APIが個人向け未公開のため、
// 「送金リンク + 管理者承認ボタン」方式で実装。
// ユーザー: 送金リンク (https://pay.paypay.ne.jp/...) と金額を提出
// 管理者: Discord上で実際にリンクを開いて受取り、承認ボタンでチップ付与

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, TextChannel } from 'discord.js';
import { db, txCredit } from '../db/schema.js';

export interface PayPayClaim {
  discordId: string;
  amountJpy: number;
  linkUrl: string;
  passcode?: string;
}

export function submitClaim(c: PayPayClaim): number {
  const stmt = db.prepare(`INSERT INTO deposits(discord_id, method, amount_jpy, amount_raw, tx_ref, status)
    VALUES (?, 'paypay', ?, ?, ?, 'pending')`);
  const info = stmt.run(c.discordId, c.amountJpy, String(c.amountJpy), c.linkUrl);
  return info.lastInsertRowid as number;
}

export async function notifyAdmins(client: Client, channelId: string, depositId: number, c: PayPayClaim) {
  const ch = await client.channels.fetch(channelId);
  if (!ch?.isTextBased()) return;
  const embed = new EmbedBuilder()
    .setTitle('🔔 PayPay 入金承認待ち')
    .addFields(
      { name: 'User', value: `<@${c.discordId}>`, inline: true },
      { name: 'Amount', value: `¥${c.amountJpy.toLocaleString()}`, inline: true },
      { name: 'Link',   value: c.linkUrl, inline: false },
      ...(c.passcode ? [{ name: 'Passcode', value: `\`${c.passcode}\``, inline: true }] : []),
    )
    .setColor(0xffa500);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`dep:approve:${depositId}`).setLabel('承認').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`dep:reject:${depositId}`).setLabel('却下').setStyle(ButtonStyle.Danger),
  );
  await (ch as TextChannel).send({ embeds: [embed], components: [row] });
}

export const approve = db.transaction((depositId: number) => {
  const dep = db.prepare('SELECT * FROM deposits WHERE id=? AND status="pending"').get(depositId) as
    { id: number; discord_id: string; amount_jpy: number } | undefined;
  if (!dep) throw new Error('deposit not found or already processed');
  db.prepare('UPDATE deposits SET status="confirmed", confirmed_at=strftime("%s","now") WHERE id=?').run(depositId);
  txCredit(dep.discord_id, dep.amount_jpy, 'deposit:paypay', String(depositId));
  return dep;
});

export function reject(depositId: number) {
  db.prepare('UPDATE deposits SET status="rejected" WHERE id=? AND status="pending"').run(depositId);
}
