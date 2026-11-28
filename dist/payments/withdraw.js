import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { db, getBalance, getReserves, debitRail, creditRail, getWagerCredit } from '../db/schema.js';
import * as pp from './paypay-client.js';
import * as wallets from './wallets.js';
import { ltcJpyRate, sendLtc, addressBalanceLtc, addressOutgoingTxs } from './ltc.js';
import { isValidLtcAddress } from './ltc-address.js';
import { MIN_WITHDRAW_JPY, LTC_NETWORK_FEE_JPY } from './limits.js';
import { emoji } from '../ui/emoji-ids.js';
function hasEnoughChips(discordId, amount) {
    return getBalance(discordId) >= amount;
}
function assertRailAvailable(discordId, rail, amount) {
    const r = getReserves(discordId);
    const have = rail === 'pp' ? r.pp : r.ltc;
    if (have < amount) {
        const label = rail === 'pp' ? 'PayPay 由来 chip' : 'LTC 由来 chip';
        throw new Error(`${label} が不足しています (保有 ¥${have.toLocaleString()} / 必要 ¥${amount.toLocaleString()})。\n` +
            `内部レートで保全されているため、入金したレール分しか出金できません。`);
    }
}
/** 出金可能額 (wager_credit) が足りるかを確認する。
 *  1 度も BET されていない chip (入金直後の資金) をそのまま別口座へ流す経路を塞ぐ。 */
function assertWagerEnough(discordId, amount) {
    const wc = getWagerCredit(discordId);
    if (wc < amount) {
        throw new Error(`出金可能額が不足しています (出金可能額 ¥${wc.toLocaleString()} / 出金額 ¥${amount.toLocaleString()})\n` +
            `ゲームでプレイすると、賭けた分だけ出金可能額が増えます。`);
    }
}
/**
 * PayPay 出金: 選ばれたウォレットから送金リンクを生成し、ユーザーに DM。
 * chip は link 生成成功時に即焼却 (link は PayPay 側で 7日有効なので十分)。
 */
export async function withdrawPayPay(client, r) {
    if (r.amountJpy < MIN_WITHDRAW_JPY.paypay)
        throw new Error(`最低出金額は ¥${MIN_WITHDRAW_JPY.paypay.toLocaleString()} です`);
    if (!hasEnoughChips(r.discordId, r.amountJpy))
        throw new Error('chip 残高が不足しています');
    assertRailAvailable(r.discordId, 'pp', r.amountJpy);
    assertWagerEnough(r.discordId, r.amountJpy);
    // 残高十分な PayPay ウォレットを 1 つ選ぶ (usable_balance で絞る)
    const candidates = wallets.listWallets('paypay').filter(w => w.enabled && (w.balance_cached ?? 0) >= r.amountJpy);
    const w = candidates[0];
    if (!w)
        throw new Error('現在このサイズの出金に対応できるウォレットがありません。もう少ししてから再試行してください。');
    // chip 焼却 → PayPay リンク作成
    const stmt = db.prepare(`INSERT INTO withdrawals(discord_id, method, amount_jpy, fee_jpy, net_jpy, passcode, wallet_id, status)
    VALUES (?, 'paypay', ?, 0, ?, ?, ?, 'pending')`);
    const info = stmt.run(r.discordId, r.amountJpy, r.amountJpy, r.passcode ?? null, w.id);
    const id = info.lastInsertRowid;
    try {
        debitRail(r.discordId, 'pp', r.amountJpy, 'withdraw:paypay', String(id));
    }
    catch (e) {
        db.prepare('UPDATE withdrawals SET status="failed", reason=? WHERE id=?').run(`chip deduct failed: ${e.message}`, id);
        throw e;
    }
    let link;
    try {
        link = await wallets.withPaypay(w, t => pp.createLink(t, r.amountJpy, r.passcode));
    }
    catch (e) {
        // 失敗: chip を払い戻し (元のレールに戻す)
        creditRail(r.discordId, 'pp', r.amountJpy, 'withdraw:paypay:refund', String(id));
        db.prepare('UPDATE withdrawals SET status="failed", reason=? WHERE id=?').run(e.message, id);
        throw e;
    }
    // 送金額ぶんを即時減算 (次の liquidity 計算で正確に反映される)
    wallets.adjustCached(w.id, -r.amountJpy);
    db.prepare('UPDATE withdrawals SET status="sent", link_url=?, tx_ref=?, completed_at=strftime("%s","now") WHERE id=?')
        .run(link.link, link.order_id, id);
    // DM
    try {
        const user = await client.users.fetch(r.discordId);
        const embed = new EmbedBuilder()
            .setTitle(`💴 PayPay 出金 — ¥${r.amountJpy.toLocaleString()}`)
            .setColor(0x22c55e)
            .setDescription('PayPay アプリで下のリンクを開いて受け取ってください。')
            .addFields({ name: 'Link', value: link.link, inline: false }, ...(r.passcode ? [{ name: 'Passcode', value: `\`${r.passcode}\``, inline: true }] : []))
            .setFooter({ text: `Withdrawal #${id} · 7日以内に受取ってください` });
        await user.send({ embeds: [embed] });
    }
    catch (e) {
        // DM 失敗: 記録だけ残して返す (ユーザーは followup で見られる)
        console.warn(`[withdraw-paypay] DM failed: ${e.message}`);
    }
    return { id, link: link.link, passcode: r.passcode };
}
/**
 * LTC 出金:
 *   1. 秘密鍵付き HOT ウォレット (derivation あり) で残高が足りるものがあれば **即自動送金**
 *   2. 無ければ従来通り admin 承認キューに流す
 */
export async function withdrawLtc(client, adminChannelId, r) {
    if (r.amountJpy < MIN_WITHDRAW_JPY.ltc)
        throw new Error(`LTC の最低出金額は ¥${MIN_WITHDRAW_JPY.ltc.toLocaleString()} です`);
    if (!r.dest)
        throw new Error('LTC アドレスが未指定');
    if (!isValidLtcAddress(r.dest))
        throw new Error('LTC アドレスではありません (L / M / ltc1 のみ受付、BTC や他通貨アドレスは拒否)');
    if (!hasEnoughChips(r.discordId, r.amountJpy))
        throw new Error('chip 残高が不足しています');
    assertRailAvailable(r.discordId, 'ltc', r.amountJpy);
    // マネロン対策: 入金してすぐ別口座へ流す経路を塞ぐ。
    // 出金可能額 (wager_credit) が出金額に届いていることを要求する (PayPay/LTC 共通)。
    assertWagerEnough(r.discordId, r.amountJpy);
    const rate = await ltcJpyRate();
    const netJpy = Math.max(0, r.amountJpy - LTC_NETWORK_FEE_JPY);
    const ltcAmount = +(netJpy / rate).toFixed(8);
    // chip 焼却 → DB 行を pending で作成 (amount_sat を入れておく: 復旧スキャンで chain と照合するキー)
    const amountSat = Math.floor(ltcAmount * 1e8);
    const stmt = db.prepare(`INSERT INTO withdrawals(discord_id, method, amount_jpy, fee_jpy, net_jpy, dest, status, amount_sat)
    VALUES (?, 'ltc', ?, ?, ?, ?, 'pending', ?)`);
    const info = stmt.run(r.discordId, r.amountJpy, LTC_NETWORK_FEE_JPY, netJpy, r.dest, amountSat);
    const id = info.lastInsertRowid;
    try {
        debitRail(r.discordId, 'ltc', r.amountJpy, 'withdraw:ltc', String(id));
    }
    catch (e) {
        db.prepare('UPDATE withdrawals SET status="failed", reason=? WHERE id=?').run(`chip deduct failed: ${e.message}`, id);
        throw e;
    }
    // ─── 1. 自動送金を試みる ───
    const hots = wallets.listLtcHotWallets();
    for (const w of hots) {
        if (!w.address)
            continue;
        let bal = 0;
        try {
            bal = await addressBalanceLtc(w.address);
        }
        catch {
            continue;
        }
        if (bal < ltcAmount + 0.0001)
            continue; // fee ぶん余分に見る
        // broadcast 前に "in-flight" marker を書く。プロセス落ち・タイムアウトで中断した場合、
        // 復帰時は status が 'broadcasting' のまま残り、二重送金可能なウィンドウを即検知できる。
        const broadcastRes = db.prepare(`UPDATE withdrawals SET status='broadcasting', wallet_id=? WHERE id=? AND status='pending'`).run(w.id, id);
        if (broadcastRes.changes !== 1) {
            // 既に別経路で処理された (管理者承認、再試行) → スキップ
            break;
        }
        try {
            const sent = await sendLtc(w.address, w.key.priv, r.dest, ltcAmount);
            db.prepare('UPDATE withdrawals SET status="sent", tx_ref=?, completed_at=strftime("%s","now") WHERE id=?')
                .run(sent.txid, id);
            wallets.adjustCached(w.id, -r.amountJpy); // 送金額ぶんを即時減算 (chain lag を待たない)
            // ユーザーに DM
            try {
                const user = await client.users.fetch(r.discordId);
                const embed = new EmbedBuilder()
                    .setTitle(`💠 LTC 出金完了 — ${ltcAmount} LTC`)
                    .setColor(0x22c55e)
                    .addFields({ name: 'To', value: `\`${r.dest}\`` }, { name: 'Amount', value: `${ltcAmount} LTC (≈ ¥${netJpy.toLocaleString()})`, inline: true }, { name: 'Fee', value: `¥${LTC_NETWORK_FEE_JPY} + network`, inline: true }, { name: 'txid', value: `\`${sent.txid}\`` })
                    .setFooter({ text: `Withdrawal #${id} · ネットワーク反映は数分〜十数分` });
                await user.send({ embeds: [embed] });
            }
            catch { /* DM 失敗は致命でない */ }
            return { id, ltcAmount, auto: true, txid: sent.txid };
        }
        catch (e) {
            // broadcast 試行が失敗 → marker を pending に戻さず 'broadcast_failed' に。
            // 二重送金リスクがあるため、管理者が実際の chain 状態を確認してから手動で
            // 'sent' or 'failed' に遷移させる。自動再試行しない。
            db.prepare(`UPDATE withdrawals SET status='broadcast_failed', reason=? WHERE id=? AND status='broadcasting'`)
                .run(e.message, id);
            console.warn(`[withdraw-ltc] auto send failed on wallet #${w.id}, marker=broadcast_failed id=${id}: ${e.message}`);
            break; // 自動 retry 中止、admin 確認待ち
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
                    .addFields({ name: 'User', value: `<@${r.discordId}>`, inline: true }, { name: 'Amount', value: `¥${r.amountJpy.toLocaleString()}`, inline: true }, { name: 'Fee', value: `¥${LTC_NETWORK_FEE_JPY}`, inline: true }, { name: 'Net JPY', value: `¥${netJpy.toLocaleString()}`, inline: true }, { name: 'LTC amt', value: `${ltcAmount} LTC`, inline: true }, { name: 'Rate', value: `¥${rate.toLocaleString()}`, inline: true }, { name: 'To', value: `\`${r.dest}\`` })
                    .setFooter({ text: `Withdrawal #${id}` });
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`wd:approve:${id}`).setLabel('Mark Sent (txid 入力)').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`wd:reject:${id}`).setLabel('Reject (返金)').setStyle(ButtonStyle.Danger));
                await ch.send({ embeds: [embed], components: [row] });
            }
        }
        catch (e) {
            console.warn(`[withdraw-ltc] admin notify failed: ${e.message}`);
        }
    }
    return { id, ltcAmount, auto: false };
}
export function markLtcSent(id, txid) {
    // 'pending' か 'broadcast_failed' (= 自動 broadcast が中断された状態) のどちらでも手動確定可能
    const r = db.prepare(`UPDATE withdrawals SET status="sent", tx_ref=?, completed_at=strftime("%s","now")
    WHERE id=? AND status IN ('pending','broadcast_failed')`).run(txid, id);
    if (r.changes === 0)
        throw new Error('withdrawal not found or already processed');
    return db.prepare('SELECT * FROM withdrawals WHERE id=?').get(id);
}
/**
 * 起動時 (および定期) に呼ぶ: broadcasting のまま残っている LTC 出金を chain から回収する。
 *
 * `sendLtc` は 3 ステップ (skeleton 作成 → 署名 → `/txs/send` ブロードキャスト) で、
 * ステップ 3 の `await` 中に BOT が落ちると DB の status は 'broadcasting' のまま残る。
 * この時、実際にブロードキャストが成立していたか BOT 側では分からない。
 *
 * 対応: 運営ウォレットから出て行った tx を chain に見に行き、
 *   - (dest, amount_sat) が一致する tx があれば → **sent** に確定 (重複送金防止 + 遅延 DM)
 *   - 2 時間経っても見つからなければ → 送金は成立していないと判断 → chip を refund
 *   - それ以外 (まだ 2h 以内) は 'broadcasting' のまま次回に持ち越し (mempool 到達待ち)
 *
 * amount_sat が無い古い行は chain 照合ができないので飛ばす (管理者の目視対応)。
 */
export async function recoverLtcBroadcasting(client) {
    const rows = db.prepare(`SELECT id, discord_id, amount_jpy, amount_sat, dest, wallet_id, created_at FROM withdrawals WHERE method='ltc' AND status='broadcasting'`).all();
    if (rows.length === 0)
        return;
    console.log(`[withdraw-recover] ${rows.length} broadcasting row(s) to check`);
    const nowSec = Math.floor(Date.now() / 1000);
    const GRACE_SEC = 2 * 3600; // 2 時間: mempool 到達の遅延余裕
    // 同じ (wallet, address) への問い合わせは 1 回にまとめる (BlockCypher レート制限回避)
    const outgoingCache = new Map();
    const getOutgoing = async (addr) => {
        if (!outgoingCache.has(addr))
            outgoingCache.set(addr, await addressOutgoingTxs(addr));
        return outgoingCache.get(addr);
    };
    for (const w of rows) {
        if (!w.dest || !w.amount_sat || !w.wallet_id) {
            console.warn(`[withdraw-recover] #${w.id}: 不足カラム (dest/amount_sat/wallet_id) — 管理者確認が必要`);
            continue;
        }
        const wallet = wallets.getWallet(w.wallet_id);
        if (!wallet?.address) {
            console.warn(`[withdraw-recover] #${w.id}: wallet #${w.wallet_id} 見つからない`);
            continue;
        }
        let outs;
        try {
            outs = await getOutgoing(wallet.address);
        }
        catch (e) {
            console.warn(`[withdraw-recover] #${w.id}: chain 照会失敗:`, e.message);
            continue;
        }
        // (dest 宛 + amount_sat 一致 + 時刻がこの出金の作成以降の近辺) の tx を探す
        const match = outs.find(tx => tx.receivedAt >= w.created_at - 300 &&
            tx.outputs.some(o => o.address === w.dest && o.valueSat === w.amount_sat));
        if (match) {
            const r = db.prepare(`UPDATE withdrawals SET status='sent', tx_ref=?, completed_at=strftime('%s','now') WHERE id=? AND status='broadcasting'`).run(match.txid, w.id);
            if (r.changes === 1) {
                console.log(`[withdraw-recover] #${w.id} → sent (chain 確認, txid=${match.txid.slice(0, 16)}…, confirmations=${match.confirmations})`);
                try {
                    const user = await client.users.fetch(w.discord_id);
                    await user.send({ embeds: [new EmbedBuilder().setColor(0x22c55e)
                                .setTitle(`${emoji('pay_ltc')} LTC 出金 #${w.id} 送信完了`)
                                .setDescription('ネットワークの反映を確認しました (遅延通知)。')
                                .addFields({ name: 'txid', value: `\`${match.txid}\`` })] });
                }
                catch { /* DM 失敗は致命でない */ }
            }
            continue;
        }
        const age = nowSec - w.created_at;
        if (age > GRACE_SEC) {
            // 2h 経っても chain に見当たらない → broadcast は成立していない。chip を元のレールに戻す
            try {
                db.transaction(() => {
                    const r = db.prepare(`UPDATE withdrawals SET status='failed', reason=?, completed_at=strftime('%s','now') WHERE id=? AND status='broadcasting'`)
                        .run('auto-refund: broadcast not seen on chain after 2h', w.id);
                    if (r.changes === 1)
                        creditRail(w.discord_id, 'ltc', w.amount_jpy, 'withdraw:refund:recovery', String(w.id));
                })();
                console.log(`[withdraw-recover] #${w.id} → refunded (${age}s elapsed, chain に無し)`);
                try {
                    const user = await client.users.fetch(w.discord_id);
                    await user.send({ embeds: [new EmbedBuilder().setColor(0xef4444)
                                .setTitle(`${emoji('rule_warn')} LTC 出金 #${w.id} — 送信できませんでした`)
                                .setDescription('システムの問題で送信が止まりました。chip は返金しましたので、もう一度やり直してください。')] });
                }
                catch { /* DM 失敗は致命でない */ }
            }
            catch (e) {
                console.error(`[withdraw-recover] #${w.id} refund 失敗:`, e.message);
            }
            continue;
        }
        console.log(`[withdraw-recover] #${w.id} 保留 (age=${age}s, GRACE=${GRACE_SEC}s まで待つ)`);
    }
}
export function rejectWithdrawal(id, reason) {
    const w = db.prepare(`SELECT * FROM withdrawals WHERE id=? AND status IN ('pending','broadcast_failed')`).get(id);
    if (!w)
        throw new Error('withdrawal not found or already processed');
    // 元のレールに戻して不変式を維持
    const rail = w.method === 'paypay' ? 'pp' : 'ltc';
    creditRail(w.discord_id, rail, w.amount_jpy, 'withdraw:refund', String(id));
    db.prepare('UPDATE withdrawals SET status="failed", reason=?, completed_at=strftime("%s","now") WHERE id=?')
        .run(reason, id);
    return w;
}
