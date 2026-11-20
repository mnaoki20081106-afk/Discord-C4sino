import { Client, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { db, txCredit, getBalance } from '../db/schema.js';
import * as pp from './paypay-client.js';
import * as wallets from './wallets.js';
import { ltcJpyRate, sendLtc, addressBalanceLtc } from './ltc.js';
import { MIN_WITHDRAW_JPY, LTC_NETWORK_FEE_JPY } from './limits.js';

export interface WithdrawReq {
  discordId: string;
  method: 'paypay' | 'ltc';
  amountJpy: number;
  passcode?: string;   // PayPay 用
  dest?: string;       // LTC アドレス
}

function hasEnoughChips(discordId: string, amount: number): boolean {
  return getBalance(discordId) >= amount;
}

/**
 * PayPay 出金: 選ばれたウォレットから送金リンクを生成し、ユーザーに DM。
 * chip は link 生成成功時に即焼却 (link は PayPay 側で 7日有効なので十分)。
 */
export async function withdrawPayPay(client: Client, r: WithdrawReq): Promise<{ id: number; link: string; passcode?: string }> {
  if (r.amountJpy < MIN_WITHDRAW_JPY.paypay) throw new Error(`最低出金額は ¥${MIN_WITHDRAW_JPY.paypay.toLocaleString()} です`);
  if (!hasEnoughChips(r.discordId, r.amountJpy)) throw new Error('chip 残高が不足しています');

  // 残高十分な PayPay ウォレットを 1 つ選ぶ (usable_balance で絞る)
  const candidates = wallets.listWallets('paypay').filter(w => w.enabled && (w.balance_cached ?? 0) >= r.amountJpy);
  const w = candidates[0];
  if (!w) throw new Error('現在このサイズの出金に対応できるウォレットがありません。もう少ししてから再試行してください。');

  // chip 焼却 → PayPay リンク作成
  const stmt = db.prepare(`INSERT INTO withdrawals(discord_id, method, amount_jpy, fee_jpy, net_jpy, passcode, wallet_id, status)
    VALUES (?, 'paypay', ?, 0, ?, ?, ?, 'pending')`);
  const info = stmt.run(r.discordId, r.amountJpy, r.amountJpy, r.passcode ?? null, w.id);
  const id = info.lastInsertRowid as number;

  try {
    txCredit(r.discordId, -r.amountJpy, 'withdraw:paypay', String(id));
  } catch (e) {
    db.prepare('UPDATE withdrawals SET status="failed", reason=? WHERE id=?').run(`chip deduct failed: ${(e as Error).message}`, id);
    throw e;
  }

  let link;
  try {
    link = await wallets.withPaypay(w, t => pp.createLink(t, r.amountJpy, r.passcode));
  } catch (e) {
    // 失敗: chip を払い戻し
    txCredit(r.discordId, r.amountJpy, 'withdraw:paypay:refund', String(id));
    db.prepare('UPDATE withdrawals SET status="failed", reason=? WHERE id=?').run((e as Error).message, id);
    throw e;
  }

  // 残高キャッシュを控えめに下げる
  const newBal = Math.max(0, (w.balance_cached ?? 0) - r.amountJpy);
  wallets.touchUsed(w.id, newBal);

  db.prepare('UPDATE withdrawals SET status="sent", link_url=?, tx_ref=?, completed_at=strftime("%s","now") WHERE id=?')
    .run(link.link, link.order_id, id);

  // DM
  try {
    const user = await client.users.fetch(r.discordId);
    const embed = new EmbedBuilder()
      .setTitle(`💴 PayPay 出金 — ¥${r.amountJpy.toLocaleString()}`)
      .setColor(0x22c55e)
      .setDescription('PayPay アプリで下のリンクを開いて受け取ってください。')
      .addFields(
        { name: 'Link', value: link.link, inline: false },
        ...(r.passcode ? [{ name: 'Passcode', value: `\`${r.passcode}\``, inline: true }] : []),
      )
      .setFooter({ text: `Withdrawal #${id} · 7日以内に受取ってください` });
    await user.send({ embeds: [embed] });
  } catch (e) {
    // DM 失敗: 記録だけ残して返す (ユーザーは followup で見られる)
    console.warn(`[withdraw-paypay] DM failed: ${(e as Error).message}`);
  }

  return { id, link: link.link, passcode: r.passcode };
}

/**
 * LTC 出金:
 *   1. 秘密鍵付き HOT ウォレット (derivation あり) で残高が足りるものがあれば **即自動送金**
 *   2. 無ければ従来通り admin 承認キューに流す
 */
export async function withdrawLtc(client: Client, adminChannelId: string | null, r: WithdrawReq): Promise<{ id: number; ltcAmount: number; auto: boolean; txid?: string }> {
  if (r.amountJpy < MIN_WITHDRAW_JPY.ltc) throw new Error(`LTC の最低出金額は ¥${MIN_WITHDRAW_JPY.ltc.toLocaleString()} です`);
  if (!r.dest) throw new Error('LTC アドレスが未指定');
  if (!/^[A-HJ-NP-Za-km-z1-9]{25,100}$|^ltc1[0-9a-z]{25,100}$/.test(r.dest)) throw new Error('LTC アドレスの形式が不正');
  if (!hasEnoughChips(r.discordId, r.amountJpy)) throw new Error('chip 残高が不足しています');

  const rate = await ltcJpyRate();
  const netJpy = Math.max(0, r.amountJpy - LTC_NETWORK_FEE_JPY);
  const ltcAmount = +(netJpy / rate).toFixed(8);

  // chip 焼却 → DB 行を pending で作成
  const stmt = db.prepare(`INSERT INTO withdrawals(discord_id, method, amount_jpy, fee_jpy, net_jpy, dest, status)
    VALUES (?, 'ltc', ?, ?, ?, ?, 'pending')`);
  const info = stmt.run(r.discordId, r.amountJpy, LTC_NETWORK_FEE_JPY, netJpy, r.dest);
  const id = info.lastInsertRowid as number;
  try {
    txCredit(r.discordId, -r.amountJpy, 'withdraw:ltc', String(id));
  } catch (e) {
    db.prepare('UPDATE withdrawals SET status="failed", reason=? WHERE id=?').run(`chip deduct failed: ${(e as Error).message}`, id);
    throw e;
  }

  // ─── 1. 自動送金を試みる ───
  const hots = wallets.listLtcHotWallets();
  for (const w of hots) {
    if (!w.address) continue;
    let bal = 0;
    try { bal = await addressBalanceLtc(w.address); } catch { continue; }
    if (bal < ltcAmount + 0.0001) continue;     // fee ぶん余分に見る

    try {
      const sent = await sendLtc(w.address, w.key.priv, r.dest, ltcAmount);
      db.prepare('UPDATE withdrawals SET status="sent", wallet_id=?, tx_ref=?, completed_at=strftime("%s","now") WHERE id=?')
        .run(w.id, sent.txid, id);
      wallets.touchUsed(w.id);

      // ユーザーに DM
      try {
        const user = await client.users.fetch(r.discordId);
        const embed = new EmbedBuilder()
          .setTitle(`💠 LTC 出金完了 — ${ltcAmount} LTC`)
          .setColor(0x22c55e)
          .addFields(
            { name: 'To',     value: `\`${r.dest}\`` },
            { name: 'Amount', value: `${ltcAmount} LTC (≈ ¥${netJpy.toLocaleString()})`, inline: true },
            { name: 'Fee',    value: `¥${LTC_NETWORK_FEE_JPY} + network`, inline: true },
            { name: 'txid',   value: `\`${sent.txid}\`` },
          )
          .setFooter({ text: `Withdrawal #${id} · ネットワーク反映は数分〜十数分` });
        await user.send({ embeds: [embed] });
      } catch { /* DM 失敗は致命でない */ }

      return { id, ltcAmount, auto: true, txid: sent.txid };
    } catch (e) {
      console.warn(`[withdraw-ltc] auto send failed on wallet #${w.id}: ${(e as Error).message}`);
      // 次の hot wallet で再試行
    }
  }

  // ─── 2. フォールバック: admin 承認 ───
  if (adminChannelId) {
    try {
      const ch = await client.channels.fetch(adminChannelId);
      if (ch && 'send' in ch) {
        const embed = new EmbedBuilder()
          .setTitle('🔔 LTC 出金申請 (手動)')
          .setColor(0xf59e0b)
          .setDescription('自動送金可能な HOT ウォレット残高が不足しています。手動で送金してください。')
          .addFields(
            { name: 'User',    value: `<@${r.discordId}>`, inline: true },
            { name: 'Amount',  value: `¥${r.amountJpy.toLocaleString()}`, inline: true },
            { name: 'Fee',     value: `¥${LTC_NETWORK_FEE_JPY}`, inline: true },
            { name: 'Net JPY', value: `¥${netJpy.toLocaleString()}`, inline: true },
            { name: 'LTC amt', value: `${ltcAmount} LTC`, inline: true },
            { name: 'Rate',    value: `¥${rate.toLocaleString()}`, inline: true },
            { name: 'To',      value: `\`${r.dest}\`` },
          )
          .setFooter({ text: `Withdrawal #${id}` });
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`wd:approve:${id}`).setLabel('Mark Sent (txid 入力)').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`wd:reject:${id}`).setLabel('Reject (返金)').setStyle(ButtonStyle.Danger),
        );
        await (ch as any).send({ embeds: [embed], components: [row] });
      }
    } catch (e) {
      console.warn(`[withdraw-ltc] admin notify failed: ${(e as Error).message}`);
    }
  }

  return { id, ltcAmount, auto: false };
}

export function markLtcSent(id: number, txid: string) {
  const r = db.prepare('UPDATE withdrawals SET status="sent", tx_ref=?, completed_at=strftime("%s","now") WHERE id=? AND status="pending"')
    .run(txid, id);
  if (r.changes === 0) throw new Error('withdrawal not found or already processed');
  return db.prepare('SELECT * FROM withdrawals WHERE id=?').get(id) as any;
}

export function rejectWithdrawal(id: number, reason: string): any {
  const w = db.prepare('SELECT * FROM withdrawals WHERE id=? AND status="pending"').get(id) as any;
  if (!w) throw new Error('withdrawal not found or already processed');
  txCredit(w.discord_id, w.amount_jpy, 'withdraw:refund', String(id));
  db.prepare('UPDATE withdrawals SET status="failed", reason=?, completed_at=strftime("%s","now") WHERE id=?')
    .run(reason, id);
  return w;
}
