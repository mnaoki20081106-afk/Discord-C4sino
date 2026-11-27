import 'dotenv/config';
import { Client, GatewayIntentBits, Partials, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, Events, PermissionFlagsBits, EmbedBuilder, ButtonBuilder, ButtonStyle, MessageFlags, } from 'discord.js';
import { adminHub, gamesLanding, walletLanding, serverLanding, gamesScreen, walletScreen, serverHome, ngScreen, userScreen, opsScreen, confirmScreen, adminModal, panelLabel, isAdminPanelKey, isLegacyPanelKey, isRulesPanelKey, mwsResetScreen, mwsWarningEmbed, ltcUnmatchedEmbed, salesScreen, } from './ui/admin-panel.js';
import { db, getBalance, txCredit, ensureUser, isBanned, assertNotBanned, creditRail, getReserves, applyMix } from './db/schema.js';
import * as sessions from './games/session-store.js';
import { openTable, replayInPlace, onTableButton, onTableSelect, onTableModal, onBlackjackAction, onVideoPokerAction, onCrapsAction, onMinesAction, isGame, setTablesClient, } from './tables.js';
import { depositPanel, depositMethodPicker, withdrawMethodPicker, balanceReply, leetPanel, mwsPanel, replayRowFromCtx, publicGamePanel } from './ui/panels.js';
import * as mws from './mws/timer.js';
import * as pp from './payments/paypay-client.js';
import * as wallets from './payments/wallets.js';
import { checkDeposits, ltcJpyRate, addressFull } from './payments/ltc.js';
import * as ltcMatch from './payments/ltc-match.js';
import { COLOR, ICON, panelEmbed } from './ui/theme.js';
import { rulesPanel, getRulesConfig, setRulesConfig } from './ui/rules.js';
import { invalidateLiquidityCache, maxAffordableBet, assertOperatorWithdrawSafe, operatorWithdrawable } from './payments/liquidity.js';
import { MIN_DEPOSIT_JPY, MIN_WITHDRAW_JPY } from './payments/limits.js';
import * as withdraw from './payments/withdraw.js';
import { L } from './ui/leet.js';
import { gameOverview } from './ui/overview.js';
import * as ach from './achievements.js';
import { removeGuildAutoMod, removeAutoModInAllGuilds, AUTOMOD_RULE_NAME, listBannedWords, addBannedWord, removeBannedWord, } from './moderation/automod.js';
import { installFilter } from './moderation/filter.js';
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // NG ワード書き換えのため (privileged)
    ],
    partials: [Partials.Channel],
});
installFilter(client);
db.exec(`CREATE TABLE IF NOT EXISTS guild_config (
  guild_id TEXT PRIMARY KEY,
  admin_channel_id TEXT
);`);
// 実績機能用カラムを追加 (存在時は無視)
for (const col of ['achievements_channel_id TEXT', 'achievements_base_name TEXT']) {
    try {
        db.exec(`ALTER TABLE guild_config ADD COLUMN ${col}`);
    }
    catch { /* exists */ }
}
function getAdminChannel(guildId) {
    const r = db.prepare('SELECT admin_channel_id FROM guild_config WHERE guild_id=?').get(guildId);
    return r?.admin_channel_id ?? null;
}
// PayPay ログイン進行状態 (discordUserId -> { sidecarSession, label, phone, guildId })
const paypayLoginFlow = new Map();
setTablesClient(client);
client.once(Events.ClientReady, async (c) => {
    console.log(`[bot] online as ${c.user.tag}`);
    // スラッシュコマンドの起動時自動登録 (SKIP_COMMAND_REGISTER=1 で無効化可能)
    if (process.env.SKIP_COMMAND_REGISTER !== '1') {
        try {
            const { registerSlashCommands } = await import('./register-commands.js');
            await registerSlashCommands();
        }
        catch (e) {
            console.error('[register] auto-register failed:', e.message);
        }
    }
    // 平文で DB に残っている既存の secrets を暗号化 (MASTER_ENC_KEY 必須)
    try {
        wallets.migrateEncryptPlaintextSecrets();
        wallets.migrateEncryptLtcAddressDerivations();
    }
    catch (e) {
        console.error('[crypto] migration failed:', e.message);
    }
    // active のまま残っていたセッションを abandoned に遷移 + BET を refund (比率不明時は PP に寄せる)
    try {
        sessions.recoverActiveSessions((discordId, amount, reason, ref, mix) => {
            // BET したときの PayPay / LTC の内訳のまま戻す。内訳が残っていない古い行だけ現比率で按分する。
            if (mix)
                applyMix(discordId, mix.pp, mix.ltc, reason, ref);
            else
                txCredit(discordId, amount, reason, ref);
        });
    }
    catch (e) {
        console.error('[sessions] recover failed:', e.message);
    }
    // Webhook rewrite 方式に切り替えたため、旧 AutoMod ブロックルールが残っていたら削除する
    try {
        await removeAutoModInAllGuilds(c);
    }
    catch (e) {
        console.error('[automod] cleanup failed:', e.message);
    }
    // MWS 延長タイマーの定期監視: 10 分間隔で残り時間を確認し、24h/6h/1h 閾値を跨いだら通知
    startMwsTicker();
});
/** MWS 延長タイマーの定期 tick (10 分間隔)。startup / クラッシュ復旧時に呼ぶ。 */
function startMwsTicker() {
    const run = async () => {
        try {
            const result = mws.evaluateTick();
            if (!result)
                return;
            // 通知はサーバー管理パネルを設置したチャンネルに送る
            const embed = mwsWarningEmbed(result.bucket, result.state.expiresAt);
            for (const channelId of serverPanelChannels()) {
                const ch = await client.channels.fetch(channelId).catch(() => null);
                if (ch && 'send' in ch)
                    await ch.send({ embeds: [embed] }).catch(() => { });
            }
        }
        catch (e) {
            console.error('[mws] tick failed:', e.message);
        }
    };
    // 起動直後に 1 回、その後 10 分おき
    run();
    setInterval(run, 10 * 60 * 1000);
}
/** サーバー管理パネルを設置しているチャンネル (MWS の期限通知の送り先) */
function serverPanelChannels() {
    return db.prepare(`SELECT DISTINCT channel_id FROM panels WHERE game='admin:server'`).all()
        .map(r => r.channel_id);
}
client.on(Events.GuildCreate, async (g) => {
    // 旧ルールが入っていたら削除
    try {
        await removeGuildAutoMod(g);
    }
    catch { /* best-effort */ }
});
client.on(Events.InteractionCreate, async (i) => {
    try {
        if (i.isChatInputCommand())
            await onCommand(i);
        else if (i.isButton())
            await onButton(i);
        else if (i.isModalSubmit())
            await onModal(i);
        else if (i.isStringSelectMenu())
            await onSelect(i);
        else if ((i.isUserSelectMenu() || i.isChannelSelectMenu()) && i.customId.startsWith('ap:'))
            await onAdminPanel(i);
    }
    catch (e) {
        console.error(e);
        const msg = `❌ ${e.message}`;
        if (i.isRepliable()) {
            if (i.replied || i.deferred)
                await i.followUp({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => { });
            else
                await i.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => { });
        }
    }
});
/* ────────────── COMMANDS ────────────── */
async function onCommand(i) {
    if (i.commandName === 'admin')
        return cmdAdmin(i);
    if (i.commandName === 'mws') {
        const state = mws.markExtended();
        return i.reply({ ...mwsResetScreen(state.expiresAt, serverPanelChannels()), flags: MessageFlags.Ephemeral });
    }
    if (i.commandName === 'leet')
        return i.showModal(leetModal());
    if (i.commandName === 'rules') {
        if (!i.guildId || !i.channel || !('send' in i.channel))
            return i.reply({ content: 'このチャンネルには設置できません', flags: MessageFlags.Ephemeral });
        setRulesConfig(i.guildId, i.options.getChannel('ticket', true).id, i.options.getChannel('verify', true).id);
        const err = await installPanel(i.guildId, i.channelId, 'rules');
        return i.reply({ content: err ? `設置できませんでした: ${err}` : '利用規約パネルを設置しました。同じチャンネルでもう一度実行すると置き直します', flags: MessageFlags.Ephemeral });
    }
}
/* ────────────── PayPay 直接操作 (ウォレット管理パネルから呼ぶ) ────────────── */
async function cmdPaypay(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
        return i.reply({ content: '権限が不足しています', flags: MessageFlags.Ephemeral });
    const sub = i.options.getSubcommand();
    if (sub === 'login') {
        const label = i.options.getString('label', true);
        const modal = new ModalBuilder().setCustomId(`wallet:paypay:start:${encodeURIComponent(label)}`).setTitle('PayPay ログイン')
            .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('phone').setLabel('電話番号 (ハイフン可)').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('password').setLabel('PayPay パスワード').setStyle(TextInputStyle.Short).setRequired(true)));
        return i.showModal(modal);
    }
    if (sub === 'balance') {
        const rows = wallets.listWallets('paypay');
        if (!rows.length)
            return i.reply({ content: 'PayPay ウォレット未登録', flags: MessageFlags.Ephemeral });
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const lines = [];
        let total = 0;
        for (const w of rows) {
            const flag = w.enabled ? '🟢' : '⚪';
            if (!w.access_token) {
                lines.push(`${flag} **#${w.id}** \`${w.label}\` — 未ログイン`);
                continue;
            }
            try {
                const b = await wallets.withPaypay(w, t => pp.walletBalance(t));
                wallets.touchUsed(w.id, b.usable_balance);
                total += b.usable_balance;
                lines.push(`${flag} **#${w.id}** \`${w.label}\` (${w.display_name ?? '-'})\n` +
                    `    usable: **¥${b.usable_balance.toLocaleString()}** / all: ¥${b.all_balance.toLocaleString()} / pt: ${b.points}`);
            }
            catch (e) {
                lines.push(`${flag} **#${w.id}** \`${w.label}\` — ❌ ${e.message}`);
            }
        }
        const embed = new EmbedBuilder()
            .setTitle('PayPay ウォレット残高')
            .setColor(0xd4af37)
            .setDescription(lines.join('\n\n'))
            .setFooter({ text: `合計 usable: ¥${total.toLocaleString()}` });
        invalidateLiquidityCache();
        return i.editReply({ embeds: [embed] });
    }
    if (sub === 'transfer') {
        const amount = i.options.getInteger('amount', true);
        const walletId = i.options.getInteger('wallet');
        const passcode = i.options.getString('passcode')?.trim() || undefined;
        if (amount < 1)
            return i.reply({ content: '金額は 1 円以上', flags: MessageFlags.Ephemeral });
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        // ウォレット選択: 指定があればそれを、無ければ balance_cached が足りる最も残量が多いものを
        let w;
        if (walletId !== null) {
            w = wallets.getWallet(walletId);
            if (!w || w.kind !== 'paypay')
                return i.editReply(`❌ wallet #${walletId} は PayPay ウォレットではありません`);
            if (!w.enabled)
                return i.editReply(`❌ wallet #${walletId} は無効化されています`);
        }
        else {
            const candidates = wallets.listWallets('paypay')
                .filter(x => x.enabled && x.access_token && (x.balance_cached ?? 0) >= amount)
                .sort((a, b) => (b.balance_cached ?? 0) - (a.balance_cached ?? 0));
            w = candidates[0];
            if (!w)
                return i.editReply(`❌ ¥${amount.toLocaleString()} を送れるウォレットがありません (残高が古い可能性: ウォレット管理パネルの「PayPay 残高を一括更新」で更新)`);
        }
        // Solvency ガード: 引き出し後も流通チップを払えるか検査
        const bad = await assertOperatorWithdrawSafe(amount, 'paypay');
        if (bad)
            return i.editReply(`❌ 引き出し拒否: ${bad}`);
        const row = db.prepare(`INSERT INTO operator_payouts(admin_id, wallet_id, amount_jpy, passcode, status)
      VALUES (?, ?, ?, ?, 'pending')`).run(i.user.id, w.id, amount, passcode ?? null);
        const opId = row.lastInsertRowid;
        let link;
        try {
            link = await wallets.withPaypay(w, t => pp.createLink(t, amount, passcode));
        }
        catch (e) {
            db.prepare('UPDATE operator_payouts SET status="failed", reason=?, completed_at=strftime("%s","now") WHERE id=?')
                .run(e.message, opId);
            return i.editReply(`❌ 送金リンク生成失敗: ${e.message}`);
        }
        db.prepare(`UPDATE operator_payouts SET status='sent', link_url=?, order_id=?, completed_at=strftime('%s','now') WHERE id=?`)
            .run(link.link, link.order_id, opId);
        wallets.adjustCached(w.id, -amount);
        invalidateLiquidityCache();
        const embed = new EmbedBuilder()
            .setTitle(`PayPay 送金リンク (運営引き出し) #${opId}`)
            .setColor(0x22c55e)
            .setDescription('PayPay アプリでこのリンクを開くと受け取れます。**チップ残高や user 出金には影響しません**。')
            .addFields({ name: 'From wallet', value: `#${w.id} \`${w.label}\``, inline: true }, { name: 'Amount', value: `¥${amount.toLocaleString()}`, inline: true }, ...(passcode ? [{ name: 'Passcode', value: `\`${passcode}\``, inline: true }] : []), { name: 'Link', value: link.link, inline: false })
            .setFooter({ text: '7 日以内に受取ってください / 受取側アカウントが同じでも OK' });
        return i.editReply({ embeds: [embed] });
    }
}
/* ────────────── WALLET ADMIN ────────────── */
async function cmdWallet(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
        return i.reply({ content: '権限が不足しています', flags: MessageFlags.Ephemeral });
    const sub = i.options.getSubcommand();
    if (sub === 'add-paypay') {
        const label = i.options.getString('label', true);
        const modal = new ModalBuilder().setCustomId(`wallet:paypay:start:${encodeURIComponent(label)}`).setTitle('PayPay ログイン')
            .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('phone').setLabel('電話番号 (ハイフン可)').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('password').setLabel('PayPay パスワード').setStyle(TextInputStyle.Short).setRequired(true)));
        return i.showModal(modal);
    }
    if (sub === 'add-ltc') {
        const label = i.options.getString('label', true);
        const address = i.options.getString('address')?.trim();
        if (address) {
            const { isValidLtcAddress } = await import('./payments/ltc-address.js');
            if (!isValidLtcAddress(address))
                return i.reply({ content: 'LTC アドレスではありません (L / M / ltc1 のみ受付)', flags: MessageFlags.Ephemeral });
            const id = wallets.addLtcWallet(i.user.id, label, address);
            if (i.guildId)
                await refreshAdminLandings(i.guildId, ['admin:wallet']);
            return i.reply({ content: `✅ LTC ウォレット (view-only) 追加 id=${id}`, flags: MessageFlags.Ephemeral });
        }
        // address 省略: BlockCypher でホットウォレット生成
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const { generateLtcHotAddress } = await import('./payments/ltc.js');
            const g = await generateLtcHotAddress();
            // derivation は wallets.addLtcWallet 側で encryptSecret される
            const derivation = JSON.stringify({ priv: g.priv, pub: g.pub });
            const id = wallets.addLtcWallet(i.user.id, label, g.address, derivation);
            if (i.guildId)
                await refreshAdminLandings(i.guildId, ['admin:wallet']);
            const embed = new EmbedBuilder()
                .setTitle(`✅ LTC HOT ウォレット生成 id=${id}`)
                .setColor(0x22c55e)
                .setDescription('**自動出金対応**。このアドレスに運営資金を送って hot wallet 残高を作ってください。')
                .addFields({ name: 'Address', value: `\`${g.address}\`` }, { name: '⚠️ 注意', value: '秘密鍵が DB に平文保存されています。大金の保管は非推奨、必要分だけ送金してください。' });
            return i.editReply({ embeds: [embed] });
        }
        catch (e) {
            return i.editReply(`❌ ${e.message}`);
        }
    }
    if (sub === 'list') {
        const rows = wallets.listWallets();
        if (!rows.length)
            return i.reply({ content: 'ウォレット未登録', flags: MessageFlags.Ephemeral });
        const embed = new EmbedBuilder().setTitle('🏦 Wallets').setColor(0xd4af37)
            .setDescription(rows.map(w => {
            const head = `**#${w.id}** [${w.kind}] ${w.enabled ? '🟢' : '⚪'} \`${w.label}\``;
            const body = w.kind === 'paypay'
                ? `  user: ${w.display_name ?? '-'} / phone: ${maskPhone(w.phone)} / 残: ${w.balance_cached ?? '?'}`
                : `  addr: \`${w.address}\``;
            return `${head}\n${body}`;
        }).join('\n\n'));
        return i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    if (sub === 'enable' || sub === 'disable') {
        const id = i.options.getInteger('id', true);
        const ok = wallets.setEnabled(id, sub === 'enable');
        return i.reply({ content: ok ? `✅ ${sub} id=${id}` : `見つかりません`, flags: MessageFlags.Ephemeral });
    }
    if (sub === 'remove') {
        const id = i.options.getInteger('id', true);
        const ok = wallets.removeWallet(id);
        return i.reply({ content: ok ? `🗑️ 削除 id=${id}` : `見つかりません`, flags: MessageFlags.Ephemeral });
    }
    if (sub === 'balance') {
        const id = i.options.getInteger('id', true);
        const w = wallets.getWallet(id);
        if (!w || w.kind !== 'paypay')
            return i.reply({ content: 'PayPay ウォレットが見つかりません', flags: MessageFlags.Ephemeral });
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const bal = await wallets.withPaypay(w, t => pp.walletBalance(t));
        wallets.touchUsed(id, bal.usable_balance);
        return i.editReply(`💰 #${id} \`${w.label}\` — usable: **¥${bal.usable_balance.toLocaleString()}** / all: ¥${bal.all_balance.toLocaleString()} / pt: ${bal.points}`);
    }
}
function maskPhone(p) {
    if (!p)
        return '-';
    const d = p.replace(/\D/g, '');
    if (d.length < 4)
        return '****';
    return `****${d.slice(-4)}`;
}
/* ────────────── ADMIN ────────────── */
/** モーダル入力を厳密パース: 整数のみ受付 (NaN, 小数, 文字混入はすべて null)。
 *  許容: 先頭末尾の空白、カンマ区切り、¥ 記号。 */
function parseStrictInt(raw) {
    if (raw == null)
        return null;
    const s = raw.replace(/[,\s¥]/g, '');
    if (!/^-?\d+$/.test(s))
        return null;
    const n = Number(s);
    if (!Number.isFinite(n) || !Number.isInteger(n))
        return null;
    return n;
}
/** ledger の reason を人間向けに整形: 'bet:blackjack' → 'BET Blackjack' など */
function formatReason(reason) {
    const [head, ...rest] = reason.split(':');
    const tail = rest.join(':');
    const gameLabel = {
        blackjack: 'Blackjack', slots: 'Slots', roulette: 'Roulette',
        baccarat: 'Baccarat', videopoker: 'Video Poker', craps: 'Craps', mines: 'Mines',
    };
    switch (head) {
        case 'bet': return `BET ${gameLabel[tail] ?? tail}`;
        case 'win': return `WIN ${gameLabel[tail] ?? tail}`;
        case 'deposit': return `DEPOSIT ${tail.toUpperCase()}`;
        case 'withdraw': return `WITHDRAW ${tail.toUpperCase()}`;
        case 'admin': return `ADMIN ${tail}`;
        case 'grant': return `GRANT ${tail.replace(':', ' ')}`;
        case 'revoke': return `REVOKE ${tail.replace(':', ' ')}`;
        case 'refund': return `REFUND ${tail}`;
        default: return reason;
    }
}
function formatLedgerLine(delta, reason, ref) {
    const sign = delta >= 0 ? '+' : '';
    return `\`${sign}¥${delta.toLocaleString()}\` ${formatReason(reason)}${ref ? ` \`(${ref.slice(0, 16)})\`` : ''}`;
}
async function cmdAdmin(i) {
    // サーバー管理画面の "Integrations → Permissions" 上書きで誤付与されても
    // 内部で ManageGuild を再チェックし素通しを防ぐ
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
        return i.reply({ content: '権限が不足しています', flags: MessageFlags.Ephemeral });
    const sub = i.options.getSubcommand();
    if (sub === 'balance') {
        const u = i.options.getUser('user', true);
        const delta = i.options.getInteger('delta', true);
        const reason = i.options.getString('reason') ?? 'admin-adjust';
        const ADMIN_DELTA_CAP = 100_000;
        if (!Number.isFinite(delta) || Math.abs(delta) > ADMIN_DELTA_CAP) {
            return i.reply({ content: `delta は -${ADMIN_DELTA_CAP.toLocaleString()} 〜 +${ADMIN_DELTA_CAP.toLocaleString()} の範囲で指定してください (監査制限)`, flags: MessageFlags.Ephemeral });
        }
        if (reason === 'admin-adjust') {
            return i.reply({ content: '理由 (reason) を明示してください (監査用)', flags: MessageFlags.Ephemeral });
        }
        try {
            ensureUser(u.id);
            txCredit(u.id, delta, `admin:${reason}`, i.user.id);
            const bal = getBalance(u.id);
            // 監査: admin チャンネルに通知
            if (i.guildId) {
                const adminCh = getAdminChannel(i.guildId);
                if (adminCh) {
                    try {
                        const ch = await client.channels.fetch(adminCh);
                        if (ch && 'send' in ch) {
                            const embed = new EmbedBuilder()
                                .setTitle('🔔 admin balance 操作')
                                .setColor(delta >= 0 ? 0xf59e0b : 0xef4444)
                                .addFields({ name: '実行者', value: `<@${i.user.id}>`, inline: true }, { name: '対象', value: `<@${u.id}>`, inline: true }, { name: 'delta', value: `${delta >= 0 ? '+' : ''}${delta.toLocaleString()}`, inline: true }, { name: '理由', value: reason });
                            await ch.send({ embeds: [embed] });
                        }
                    }
                    catch { /* best-effort */ }
                }
            }
            return i.reply({ content: `✅ <@${u.id}> ${delta >= 0 ? '+' : ''}${delta} → 残高 ${bal.toLocaleString()}`, flags: MessageFlags.Ephemeral });
        }
        catch (e) {
            return i.reply({ content: `❌ ${e.message}`, flags: MessageFlags.Ephemeral });
        }
    }
    if (sub === 'ban') {
        const u = i.options.getUser('user', true);
        const reason = i.options.getString('reason') ?? '';
        db.prepare('INSERT OR REPLACE INTO user_bans(discord_id, reason) VALUES (?,?)').run(u.id, reason);
        return i.reply({ content: `🚫 <@${u.id}> BAN`, flags: MessageFlags.Ephemeral });
    }
    if (sub === 'unban') {
        const u = i.options.getUser('user', true);
        db.prepare('DELETE FROM user_bans WHERE discord_id=?').run(u.id);
        return i.reply({ content: `✅ <@${u.id}> BAN解除`, flags: MessageFlags.Ephemeral });
    }
    if (sub === 'stats') {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const users = db.prepare('SELECT COUNT(*) c FROM users').get().c;
        const chips = db.prepare('SELECT COALESCE(SUM(balance),0) s FROM users').get().s;
        const bets = db.prepare("SELECT COALESCE(SUM(-delta),0) s FROM ledger WHERE reason LIKE 'bet:%'").get().s;
        const wins = db.prepare("SELECT COALESCE(SUM(delta),0) s FROM ledger WHERE reason LIKE 'win:%'").get().s;
        const deps = db.prepare("SELECT COALESCE(SUM(amount_jpy),0) s FROM deposits WHERE status='confirmed'").get().s;
        const walletsCount = db.prepare('SELECT COUNT(*) c FROM wallets WHERE enabled=1').get().c;
        const m = await maxAffordableBet();
        const embed = new EmbedBuilder().setTitle('📊 C4sino Stats').setColor(0xd4af37)
            .addFields({ name: 'ユーザー数', value: `${users}`, inline: true }, { name: '流通チップ', value: `${chips.toLocaleString()}`, inline: true }, { name: '有効ウォレット', value: `${walletsCount}`, inline: true }, { name: '累計 BET', value: `${bets.toLocaleString()}`, inline: true }, { name: '累計 WIN', value: `${wins.toLocaleString()}`, inline: true }, { name: 'ハウスエッジ', value: `${(bets - wins).toLocaleString()}`, inline: true }, { name: '入金合計 (JPY換算)', value: `¥${deps.toLocaleString()}`, inline: false }, { name: '🏦 ウォレット流動性',
            value: `PayPay: ¥${m.liq.paypay.toLocaleString()}\nLTC: ¥${m.liq.ltc.toLocaleString()}\n` +
                `合計: ¥${m.liq.total.toLocaleString()}\n債務 (流通チップ): -¥${m.outstanding.toLocaleString()}\n` +
                `**実効流動性: ¥${m.effective.toLocaleString()}**`,
            inline: false }, { name: '📐 許容 BET 上限',
            value: `Blackjack:   **${m.blackjack.toLocaleString()}**\n` +
                `Slots:       **${m.slots.toLocaleString()}**\n` +
                `Roulette:    **${m.roulette.toLocaleString()}**\n` +
                `Baccarat:    **${m.baccarat.toLocaleString()}**\n` +
                `Video Poker: **${m.videopoker.toLocaleString()}**\n` +
                `Craps:       **${m.craps.toLocaleString()}**`,
            inline: false });
        return i.editReply({ embeds: [embed] });
    }
    if (sub === 'tx') {
        const u = i.options.getUser('user', true);
        const limit = i.options.getInteger('limit') ?? 10;
        const rows = db.prepare('SELECT delta, reason, ref, created_at FROM ledger WHERE discord_id=? ORDER BY id DESC LIMIT ?')
            .all(u.id, Math.max(1, Math.min(50, limit)));
        if (!rows.length)
            return i.reply({ content: '取引なし', flags: MessageFlags.Ephemeral });
        const bal = getBalance(u.id);
        const list = rows.map(r => {
            const d = new Date(r.created_at * 1000).toISOString().replace('T', ' ').slice(0, 16);
            return `\`${d}\` ${r.delta >= 0 ? '+' : ''}${r.delta} — ${r.reason}${r.ref ? ` (${r.ref})` : ''}`;
        }).join('\n');
        const embed = new EmbedBuilder().setTitle(`📜 <@${u.id}> のTX`).setDescription(list).setFooter({ text: `現残高 ${bal.toLocaleString()}` });
        return i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    if (sub === 'history') {
        const u = i.options.getUser('user', true);
        const type = (i.options.getString('type') ?? 'all');
        const limit = i.options.getInteger('limit') ?? 20;
        ensureUser(u.id);
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const rows = [];
        if (type === 'all' || type === 'bets') {
            const r = db.prepare(`SELECT delta, reason, ref, created_at FROM ledger WHERE discord_id=? AND reason LIKE 'bet:%' ORDER BY id DESC LIMIT ?`).all(u.id, limit);
            for (const t of r)
                rows.push({ at: t.created_at, kind: 'BET', delta: t.delta, label: formatReason(t.reason), ref: t.ref ?? '' });
        }
        if (type === 'all' || type === 'wins') {
            const r = db.prepare(`SELECT delta, reason, ref, created_at FROM ledger WHERE discord_id=? AND reason LIKE 'win:%' ORDER BY id DESC LIMIT ?`).all(u.id, limit);
            for (const t of r)
                rows.push({ at: t.created_at, kind: 'WIN', delta: t.delta, label: formatReason(t.reason), ref: t.ref ?? '' });
        }
        if (type === 'all' || type === 'deposits') {
            const r = db.prepare(`SELECT method, amount_jpy, tx_ref, status, created_at FROM deposits WHERE discord_id=? ORDER BY created_at DESC LIMIT ?`).all(u.id, limit);
            for (const d of r)
                rows.push({
                    at: d.created_at, kind: 'DEPOSIT',
                    delta: d.status === 'confirmed' ? d.amount_jpy : 0,
                    label: `${d.method.toUpperCase()} (${d.status})`, ref: d.tx_ref ?? '',
                });
        }
        if (type === 'all' || type === 'withdrawals') {
            const r = db.prepare(`SELECT id, method, amount_jpy, dest, tx_ref, link_url, status, reason, created_at FROM withdrawals WHERE discord_id=? ORDER BY created_at DESC LIMIT ?`).all(u.id, limit);
            for (const w of r)
                rows.push({
                    at: w.created_at, kind: 'WITHDRAW',
                    delta: w.status === 'sent' ? -w.amount_jpy : 0,
                    label: `${w.method.toUpperCase()} #${w.id} (${w.status})${w.dest ? ` → ${('' + w.dest).slice(0, 14)}…` : ''}${w.reason ? ` [${w.reason}]` : ''}`,
                    ref: w.tx_ref ?? '',
                });
        }
        if (type === 'all' || type === 'grants') {
            const r = db.prepare(`SELECT delta, reason, ref, created_at FROM ledger WHERE discord_id=? AND (reason LIKE 'admin:%' OR reason LIKE 'grant:%' OR reason LIKE 'revoke:%' OR reason LIKE 'refund%') ORDER BY id DESC LIMIT ?`).all(u.id, limit);
            for (const t of r)
                rows.push({ at: t.created_at, kind: 'ADMIN', delta: t.delta, label: formatReason(t.reason), ref: t.ref ?? '' });
        }
        rows.sort((a, b) => b.at - a.at);
        const shown = rows.slice(0, limit);
        const lines = shown.map(r => {
            const sign = r.delta === 0 ? '  ' : r.delta > 0 ? '+ ' : '− ';
            const amt = r.delta === 0 ? '      ' : Math.abs(r.delta).toLocaleString().padStart(7);
            return `\`<t:${r.at}:f>\` **${r.kind.padEnd(8)}** \`${sign}¥${amt}\` ${r.label}${r.ref ? ` \`(${r.ref.slice(0, 16)})\`` : ''}`;
        });
        const embed = new EmbedBuilder()
            .setTitle(`履歴 — <@${u.id}>  ${type === 'all' ? '' : `(${type})`}`)
            .setColor(0xd4af37)
            .setDescription(lines.length ? lines.join('\n').slice(0, 4000) : '_(該当なし)_')
            .setFooter({ text: `件数: ${shown.length} / 要求: ${limit} · 種類で絞る: type:bets|wins|deposits|withdrawals|grants` });
        return i.editReply({ embeds: [embed] });
    }
    if (sub === 'user') {
        const u = i.options.getUser('user', true);
        ensureUser(u.id);
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const r = getReserves(u.id);
        const bets = db.prepare(`SELECT COALESCE(SUM(-delta),0) s FROM ledger WHERE discord_id=? AND reason LIKE 'bet:%'`).get(u.id).s;
        const wins = db.prepare(`SELECT COALESCE(SUM(delta),0)  s FROM ledger WHERE discord_id=? AND reason LIKE 'win:%'`).get(u.id).s;
        const depConfirmed = db.prepare(`SELECT method, COALESCE(SUM(amount_jpy),0) s FROM deposits WHERE discord_id=? AND status='confirmed' GROUP BY method`).all(u.id);
        const wdSent = db.prepare(`SELECT method, COALESCE(SUM(amount_jpy),0) s FROM withdrawals WHERE discord_id=? AND status='sent' GROUP BY method`).all(u.id);
        const ban = db.prepare('SELECT reason, banned_at FROM user_bans WHERE discord_id=?').get(u.id);
        const lastTx = db.prepare(`SELECT delta, reason, ref, created_at FROM ledger WHERE discord_id=? ORDER BY id DESC LIMIT 10`).all(u.id);
        const openWd = db.prepare(`SELECT id, method, amount_jpy, status, created_at FROM withdrawals WHERE discord_id=? AND status IN ('pending','sent','failed') ORDER BY created_at DESC LIMIT 10`).all(u.id);
        const activeSessions = sessions.listByUser(u.id);
        const sum = (rows, m) => rows.find(x => x.method === m)?.s ?? 0;
        const payload = await balanceReply(r.pp, r.ltc);
        const embed = new EmbedBuilder()
            .setTitle(`ユーザー総合ビュー`)
            .setColor(ban ? 0xef4444 : 0xd4af37)
            .setDescription(`<@${u.id}>  (\`${u.id}\`)` + (ban ? `\n🚫 **BAN**: ${ban.reason || '(理由なし)'} <t:${ban.banned_at}:R>` : ''))
            .addFields({ name: '累計 BET', value: `¥${bets.toLocaleString()}`, inline: true }, { name: '累計 WIN', value: `¥${wins.toLocaleString()}`, inline: true }, { name: 'ハウス収支', value: `${(bets - wins) >= 0 ? '+' : ''}¥${(bets - wins).toLocaleString()}`, inline: true }, { name: '入金合計', value: `PayPay: ¥${sum(depConfirmed, 'paypay').toLocaleString()}\n` +
                `LTC:    ¥${sum(depConfirmed, 'ltc').toLocaleString()}`, inline: true }, { name: '出金合計 (sent)', value: `PayPay: ¥${sum(wdSent, 'paypay').toLocaleString()}\n` +
                `LTC:    ¥${sum(wdSent, 'ltc').toLocaleString()}`, inline: true }, { name: '稼働セッション', value: activeSessions.length
                ? activeSessions.map(s => `${s.game} / bet ${s.bet.toLocaleString()}${s.mix ? ` (PP${s.mix.pp.toLocaleString()}+LTC${s.mix.ltc.toLocaleString()})` : ''} / sid \`${s.id.slice(0, 8)}\``).join('\n')
                : '_(なし)_', inline: false }, { name: '直近出金 (10件)', value: openWd.length
                ? openWd.map(w => {
                    const m = w.status === 'pending' ? '🟡' : w.status === 'sent' ? '🟢' : '🔴';
                    return `#${w.id} ${m} \`<t:${w.created_at}:f>\` ${w.method} ¥${w.amount_jpy.toLocaleString()}`;
                }).join('\n').slice(0, 1024)
                : '_(なし)_', inline: false }, { name: '直近取引 10 件 (ledger)', value: lastTx.length
                ? lastTx.map(t => `\`<t:${t.created_at}:f>\` ${formatLedgerLine(t.delta, t.reason, t.ref)}`).join('\n').slice(0, 1024)
                : '_(なし)_', inline: false })
            .setFooter({ text: '取引履歴・chip 付与・BAN はサーバー管理パネルの「ユーザー管理」から' });
        return i.editReply({ embeds: [...payload.embeds, embed], files: payload.files });
    }
    if (sub === 'pending') {
        const methodFilter = i.options.getString('method');
        const limit = Math.min(25, Math.max(1, i.options.getInteger('limit') ?? 10));
        const where = methodFilter
            ? `WHERE status IN ('pending','sent','failed') AND method=?`
            : `WHERE status IN ('pending','sent','failed')`;
        const rows = db.prepare(`SELECT * FROM withdrawals ${where} ORDER BY created_at DESC LIMIT ?`)
            .all(...(methodFilter ? [methodFilter, limit] : [limit]));
        if (!rows.length)
            return i.reply({ content: '該当する出金はありません', flags: MessageFlags.Ephemeral });
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const lines = [];
        for (const w of rows) {
            const ago = `<t:${w.created_at}:R>`;
            const marker = w.status === 'pending' ? '🟡' : w.status === 'sent' ? '🟢' : '🔴';
            const summary = w.method === 'paypay'
                ? `**#${w.id}** ${marker} PayPay ¥${w.amount_jpy.toLocaleString()} → <@${w.discord_id}>  ${ago}` +
                    (w.link_url ? `\n     link: ${w.link_url}` : '') +
                    (w.passcode ? ` (passcode \`${w.passcode}\`)` : '') +
                    (w.reason ? `\n     reason: ${w.reason}` : '')
                : `**#${w.id}** ${marker} LTC ¥${w.amount_jpy.toLocaleString()} → <@${w.discord_id}>  ${ago}` +
                    `\n     dest: \`${w.dest}\`` +
                    (w.tx_ref ? `\n     txid: \`${w.tx_ref}\`` : '') +
                    (w.reason ? `\n     reason: ${w.reason}` : '');
            lines.push(summary);
        }
        const embed = new EmbedBuilder()
            .setTitle('保留中/直近の出金')
            .setColor(0xd4af37)
            .setDescription(lines.join('\n\n').slice(0, 4000))
            .setFooter({ text: 'pending (🟡) の LTC は /admin resolve-withdraw で手動承認/却下' });
        // 最初の pending LTC があればそれ用のボタン行を 1 つ付ける
        const firstPendingLtc = rows.find(w => w.status === 'pending' && w.method === 'ltc');
        const components = [];
        if (firstPendingLtc) {
            components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`wd:approve:${firstPendingLtc.id}`).setLabel(`LTC #${firstPendingLtc.id} 承認`).setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`wd:reject:${firstPendingLtc.id}`).setLabel(`LTC #${firstPendingLtc.id} 却下 (返金)`).setStyle(ButtonStyle.Danger)));
        }
        return i.editReply({ embeds: [embed], components });
    }
    if (sub === 'grant') {
        const u = i.options.getUser('user', true);
        const rail = i.options.getString('rail', true);
        const amount = i.options.getInteger('amount', true);
        const reason = i.options.getString('reason') ?? 'admin-grant';
        ensureUser(u.id);
        try {
            if (amount > 0) {
                creditRail(u.id, rail, amount, `grant:${rail}:${reason}`, i.user.id);
            }
            else if (amount < 0) {
                const { debitRail } = await import('./db/schema.js');
                debitRail(u.id, rail, -amount, `revoke:${rail}:${reason}`, i.user.id);
            }
            else
                return i.reply({ content: '金額が 0 です', flags: MessageFlags.Ephemeral });
        }
        catch (e) {
            return i.reply({ content: `❌ ${e.message}`, flags: MessageFlags.Ephemeral });
        }
        const r = getReserves(u.id);
        return i.reply({
            content: `✅ <@${u.id}> に ${rail.toUpperCase()} 由来 ${amount >= 0 ? '+' : ''}¥${amount.toLocaleString()} を適用\n` +
                `内訳: PP ¥${r.pp.toLocaleString()} / LTC ¥${r.ltc.toLocaleString()} / 合計 ¥${r.total.toLocaleString()}`,
            flags: MessageFlags.Ephemeral,
        });
    }
    if (sub === 'send-paypay') {
        const u = i.options.getUser('user', true);
        const amount = i.options.getInteger('amount', true);
        const passcode = i.options.getString('passcode')?.trim() || undefined;
        const reason = i.options.getString('reason') ?? 'admin-send';
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const bad = await assertOperatorWithdrawSafe(amount, 'paypay');
        if (bad)
            return i.editReply(`❌ 送金拒否: ${bad}`);
        const candidates = wallets.listWallets('paypay')
            .filter(x => x.enabled && x.access_token && (x.balance_cached ?? 0) >= amount)
            .sort((a, b) => (b.balance_cached ?? 0) - (a.balance_cached ?? 0));
        const w = candidates[0];
        if (!w)
            return i.editReply(`❌ ¥${amount.toLocaleString()} を送れる PayPay ウォレットがありません`);
        const opRow = db.prepare(`INSERT INTO operator_payouts(admin_id, wallet_id, amount_jpy, passcode, status, reason)
      VALUES (?, ?, ?, ?, 'pending', ?)`).run(i.user.id, w.id, amount, passcode ?? null, `send-paypay:to:${u.id}:${reason}`);
        const opId = opRow.lastInsertRowid;
        let link;
        try {
            link = await wallets.withPaypay(w, t => pp.createLink(t, amount, passcode));
        }
        catch (e) {
            db.prepare('UPDATE operator_payouts SET status="failed", reason=?, completed_at=strftime("%s","now") WHERE id=?').run(e.message, opId);
            return i.editReply(`❌ リンク生成失敗: ${e.message}`);
        }
        db.prepare(`UPDATE operator_payouts SET status='sent', link_url=?, order_id=?, completed_at=strftime('%s','now') WHERE id=?`)
            .run(link.link, link.order_id, opId);
        wallets.adjustCached(w.id, -amount);
        invalidateLiquidityCache();
        // ユーザーに DM
        try {
            const target = await client.users.fetch(u.id);
            const embed = new EmbedBuilder()
                .setTitle(`PayPay 送金リンク — ¥${amount.toLocaleString()}`)
                .setColor(0x22c55e)
                .setDescription('運営から送金が届きました。')
                .addFields({ name: 'Link', value: link.link }, ...(passcode ? [{ name: 'Passcode', value: `\`${passcode}\``, inline: true }] : []), { name: 'Reason', value: reason, inline: true })
                .setFooter({ text: `Operator payout #${opId}` });
            await target.send({ embeds: [embed] });
        }
        catch (e) {
            console.warn('[admin send-paypay] DM failed:', e.message);
        }
        return i.editReply(`✅ <@${u.id}> に PayPay ¥${amount.toLocaleString()} を送金 (opId #${opId}, wallet #${w.id})`);
    }
    if (sub === 'send-ltc') {
        const u = i.options.getUser('user', true);
        const dest = i.options.getString('dest', true).trim();
        const ltcAmount = i.options.getNumber('ltc', true);
        const reason = i.options.getString('reason') ?? 'admin-send';
        const { isValidLtcAddress } = await import('./payments/ltc-address.js');
        if (!isValidLtcAddress(dest))
            return i.reply({ content: '❌ LTC アドレスではありません (L / M / ltc1 のみ受付)', flags: MessageFlags.Ephemeral });
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const rate = await (await import('./payments/ltc.js')).ltcJpyRate();
        const jpy = Math.floor(ltcAmount * rate);
        const bad = await assertOperatorWithdrawSafe(jpy, 'ltc');
        if (bad)
            return i.editReply(`❌ 送金拒否: ${bad}`);
        const { sendLtc } = await import('./payments/ltc.js');
        const hots = wallets.listLtcHotWallets();
        let lastErr = 'HOT ウォレットが見つかりません';
        for (const w of hots) {
            try {
                const sent = await sendLtc(w.address, w.key.priv, dest, ltcAmount);
                wallets.adjustCached(w.id, -jpy);
                invalidateLiquidityCache();
                const opRow = db.prepare(`INSERT INTO operator_payouts(admin_id, wallet_id, amount_jpy, status, link_url, order_id, reason, completed_at)
          VALUES (?, ?, ?, 'sent', ?, ?, ?, strftime('%s','now'))`)
                    .run(i.user.id, w.id, jpy, dest, sent.txid, `send-ltc:to:${u.id}:${reason}`);
                try {
                    const target = await client.users.fetch(u.id);
                    const embed = new EmbedBuilder()
                        .setTitle(`LTC 送金完了 — ${ltcAmount} LTC`)
                        .setColor(0x22c55e)
                        .addFields({ name: 'To', value: `\`${dest}\`` }, { name: 'Amount', value: `${ltcAmount} LTC (≈ ¥${jpy.toLocaleString()})`, inline: true }, { name: 'Reason', value: reason, inline: true }, { name: 'txid', value: `\`${sent.txid}\`` })
                        .setFooter({ text: `Operator payout #${opRow.lastInsertRowid}` });
                    await target.send({ embeds: [embed] });
                }
                catch { /* DM 失敗は致命でない */ }
                return i.editReply(`✅ <@${u.id}> に ${ltcAmount} LTC (≈ ¥${jpy.toLocaleString()}) 送金完了\ntxid: \`${sent.txid}\``);
            }
            catch (e) {
                lastErr = e.message;
            }
        }
        return i.editReply(`❌ LTC 送金失敗: ${lastErr}`);
    }
    if (sub === 'automod-sync') {
        if (!i.guild)
            return i.reply({ content: 'ギルド内で実行してください', flags: MessageFlags.Ephemeral });
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const removed = await removeGuildAutoMod(i.guild);
            return i.editReply(removed
                ? `✅ 旧 AutoMod rule \`${AUTOMOD_RULE_NAME}\` を削除しました。NG 語は Webhook 書き換え方式で処理されます。`
                : `ℹ️ 削除対象なし (すでに Webhook 書き換え方式のみ有効)`);
        }
        catch (e) {
            return i.editReply(`❌ AutoMod cleanup 失敗: ${e.message}`);
        }
    }
    if (sub === 'achievements') {
        const ch = i.options.getChannel('channel');
        if (!ch) {
            ach.setConfig(i.guildId, null, null);
            return i.reply({ content: '✅ 実績チャンネルを解除しました', flags: MessageFlags.Ephemeral });
        }
        const base = i.options.getString('base') ?? (ch.name ?? 'achievements').replace(/[-_ー]実績\d+件$/, '');
        ach.setConfig(i.guildId, ch.id, base);
        const count = ach.countAchievements(i.guildId);
        // 即リネームを試みる
        try {
            const fetched = await client.channels.fetch(ch.id);
            if (fetched && 'setName' in fetched)
                await fetched.setName(ach.formatChannelName(base, count));
        }
        catch (e) { /* rate limit など */ }
        return i.reply({
            content: `✅ 実績チャンネル: <#${ch.id}>\nベース名: \`${base}\`  /  現在 ${count} 件`,
            flags: MessageFlags.Ephemeral
        });
    }
    if (sub === 'panel') {
        if (!i.channel || !('send' in i.channel))
            return i.reply({ content: 'このチャンネルには設置できません', flags: MessageFlags.Ephemeral });
        const type = i.options.getString('type', true);
        const key = `admin:${type}`;
        const err = await installPanel(i.guildId, i.channelId, key);
        return i.reply({ content: err ? `設置できませんでした: ${err}` : `${panelLabel(key)}を設置しました`, flags: MessageFlags.Ephemeral });
    }
}
/* ────────────── BUTTONS ────────────── */
async function onButton(i) {
    const [ns, kind, arg] = i.customId.split(':');
    if (ns === 't')
        return onTableButton(i); // t:<game>:<action>[:arg] (テーブル上の操作)
    if (ns === 'play') { // play:<game>[:<賭け先/掛け方>] (チャンネルのパネル)
        if (!isGame(kind))
            return;
        const opt = kind === 'roulette' && arg === 'straight' ? 'number' : arg;
        return openTable(i, kind, opt);
    }
    if (ns === 'replay' && isGame(kind))
        return replayInPlace(i, kind);
    if (ns === 'leet' && kind === 'convert')
        return onLeetButton(i);
    if (ns === 'bj') {
        if (kind === 'act')
            return onBlackjackAction(i, arg);
        return openTable(i, 'blackjack'); // 以前のパネルの固定額ボタン
    }
    if (ns === 'vp') {
        if (kind === 'hold' || kind === 'draw')
            return onVideoPokerAction(i, kind, arg);
        return openTable(i, 'videopoker');
    }
    if (ns === 'mn' && (kind === 'open' || kind === 'cash'))
        return onMinesAction(i, kind, arg);
    if (ns === 'cr') {
        if (kind === 'roll' || kind === 'undo' || kind === 'clear' || kind === 'end')
            return onCrapsAction(i, kind);
        if (kind === 'q')
            return onCrapsAction(i, 'q', arg); // cr:q:<賭けの種類>:<sid> (クイック BET)
        return openTable(i, 'craps');
    }
    if (ns === 'slot')
        return openTable(i, 'slots');
    if (ns === 'rou')
        return openTable(i, 'roulette');
    if (ns === 'bac')
        return openTable(i, 'baccarat', kind === 'side' ? arg : undefined);
    if (ns === 'dep')
        return onDepositButton(i, kind, i.customId.split(':').slice(2).join(':'));
    if (ns === 'ap')
        return onAdminPanel(i);
    if (ns === 'adm')
        return onAdminButton(i, kind);
    if (ns === 'wd' && (kind === 'approve' || kind === 'reject'))
        return onWithdrawAdmin(i, kind, arg);
    if (ns === 'wd' && (kind === 'open' || kind === 'paypay' || kind === 'ltc'))
        return onWithdrawUserButton(i, kind);
    if (ns === 'mws')
        return onMwsButton(i, kind);
    if (ns === 'bal') {
        const r = getReserves(i.user.id);
        const payload = await balanceReply(r.pp, r.ltc);
        return i.reply({ ...payload, flags: MessageFlags.Ephemeral });
    }
}
/**
 * MWS keep-alive panel buttons:
 *   mws:extended      — 延長完了 (タイマーリセット、管理者のみ)
 *   mws:notify_here   — 通知先をこのチャンネルに設定 (管理者のみ)
 *   mws:notify_clear  — 通知先を解除 (管理者のみ)
 *   mws:refresh       — パネル表示を更新 (誰でも)
 */
async function onMwsButton(i, kind) {
    const isAdmin = i.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ?? false;
    if (kind === 'refresh') {
        const state = mws.getState();
        return i.update(mwsPanel(state));
    }
    if (!isAdmin) {
        return i.reply({ content: '管理者のみが操作できます (ManageChannels 権限)', flags: MessageFlags.Ephemeral });
    }
    if (kind === 'extended') {
        const state = mws.markExtended();
        await i.update(mwsPanel(state));
        return i.followUp({ content: `✅ タイマーをリセットしました。次回期限: <t:${state.expiresAt}:f>`, flags: MessageFlags.Ephemeral });
    }
    if (kind === 'notify_here') {
        const state = mws.setNotifyTarget(i.channelId);
        return i.update(mwsPanel(state));
    }
    if (kind === 'notify_clear') {
        const state = mws.clearNotifyTarget();
        return i.update(mwsPanel(state));
    }
}
async function onWithdrawAdmin(i, kind, arg) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
        return i.reply({ content: '権限不足', flags: MessageFlags.Ephemeral });
    const id = parseInt(arg, 10);
    if (kind === 'approve') {
        const modal = new ModalBuilder().setCustomId(`wd:approve:${id}`).setTitle(`LTC 出金 #${id} — Mark Sent`)
            .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('txid').setLabel('LTC Transaction ID (txid)').setStyle(TextInputStyle.Short).setRequired(true)));
        return i.showModal(modal);
    }
    if (kind === 'reject') {
        try {
            const w = withdraw.rejectWithdrawal(id, 'rejected by admin');
            await i.update({
                components: [],
                embeds: [EmbedBuilder.from(i.message.embeds[0]).setColor(0xef4444).setTitle('❌ Rejected (返金済み)')],
            });
            const user = await client.users.fetch(w.discord_id).catch(() => null);
            await user?.send(`❌ LTC 出金 #${id} は却下されました。chip を返金しました。`).catch(() => { });
        }
        catch (e) {
            await i.reply({ content: `❌ ${e.message}`, flags: MessageFlags.Ephemeral });
        }
    }
}
/** 以前の管理パネル (adm:stats / adm:wallets / adm:pending) のボタン */
async function onAdminButton(i, kind) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
        return i.reply({ content: '権限不足', flags: MessageFlags.Ephemeral });
    if (kind === 'stats')
        return cmdAdmin(asCommand(i, 'stats'));
    if (kind === 'wallets')
        return renderAdmin(i, 'wallet');
    if (kind === 'pending')
        return replyRecentDeposits(i);
}
/** 管理者ごとの選択中の値 (設置するパネルの種類・チャンネル、ウォレット、ユーザー)。 */
const adminSel = new Map();
const selOf = (uid) => { let s = adminSel.get(uid); if (!s) {
    s = {};
    adminSel.set(uid, s);
} return s; };
/**
 * 既存のコマンド処理 (cmdAdmin / cmdWallet / cmdPaypay) をパネルから呼ぶための変換。
 * 入力画面などで集めた値を、コマンドの入力欄 (i.options.getXxx) と同じ形で渡す。
 * Object.create で元の操作を下敷きにするので、reply などの機能はそのまま使える。
 */
function asCommand(i, sub, values = {}) {
    const get = (name) => (values[name] ?? null);
    const options = {
        getSubcommand: () => sub,
        getString: get, getInteger: get, getNumber: get, getUser: get, getChannel: get, getBoolean: get,
    };
    return Object.assign(Object.create(i), { options });
}
const isEphemeralMsg = (i) => 'message' in i && !!i.message && (i.message.flags?.has(MessageFlags.Ephemeral) ?? false);
/** 管理パネルの画面を出す。チャンネルのハブから押されたら本人だけの新しい画面、画面の中なら書き換え。 */
async function showAdmin(i, payload) {
    if (i.deferred || i.replied)
        return i.editReply(payload);
    if (isEphemeralMsg(i)) {
        if (i.isModalSubmit()) {
            if (i.isFromMessage())
                return i.update(payload);
        }
        else
            return i.update(payload);
    }
    return i.reply({ ...payload, flags: MessageFlags.Ephemeral });
}
/** ゲーム管理パネルが扱うパネル (ゲーム・入出金・ルール説明など)。管理パネル自身は含めない。 */
function gamePanels(guildId) {
    return installedPanels(guildId).filter(p => !isAdminPanelKey(p.game) && !isRulesPanelKey(p.game));
}
function installedPanels(guildId) {
    return db.prepare('SELECT channel_id, message_id, game FROM panels WHERE guild_id=? ORDER BY rowid').all(guildId);
}
/** 設置するパネルの中身。key は PANEL_KINDS の key。 */
function panelPayload(guildId, key) {
    if (key === 'admin:games')
        return gamesLanding(gamePanels(guildId));
    if (key === 'admin:wallet')
        return walletLanding(adminWallets());
    if (key === 'admin:server')
        return serverLanding();
    if (isGame(key))
        return publicGamePanel(key);
    if (key === 'cashier')
        return depositPanel();
    if (key.startsWith('overview:'))
        return { embeds: [gameOverview(key.slice(9))] };
    if (key === 'rules') {
        const cfg = getRulesConfig(guildId);
        return cfg ? rulesPanel(cfg) : null;
    }
    if (key === 'mws')
        return mwsPanel(mws.getState());
    if (key === 'leet')
        return leetPanel();
    if (key === 'admin')
        return adminHub(); // 以前の 1 枚にまとめた管理パネル
    return null;
}
/** 1 つ設置する。同じチャンネルに同じ種類があれば、古い方を消して置き直す。 */
async function installPanel(guildId, channelId, key) {
    const payload = panelPayload(guildId, key);
    if (!payload)
        return '不明なパネルです';
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch || !('send' in ch))
        return 'そのチャンネルには投稿できません';
    const old = db.prepare('SELECT message_id FROM panels WHERE channel_id=? AND game=?').get(channelId, key);
    if (old && 'messages' in ch)
        await ch.messages.delete(old.message_id).catch(() => { });
    try {
        const msg = await ch.send(payload);
        db.prepare('INSERT OR REPLACE INTO panels(guild_id,channel_id,message_id,game) VALUES (?,?,?,?)').run(guildId, channelId, msg.id, key);
        return null;
    }
    catch (e) {
        return `投稿できませんでした (${e.message})`;
    }
}
/** チャンネルに常設しているゲーム管理パネル / ウォレット管理パネルの一覧を最新にする。 */
async function refreshAdminLandings(guildId, keys) {
    const rows = db.prepare('SELECT channel_id, message_id, game FROM panels WHERE guild_id=?').all(guildId)
        .filter(p => keys.includes(p.game));
    for (const p of rows) {
        const payload = panelPayload(guildId, p.game);
        const ch = await client.channels.fetch(p.channel_id).catch(() => null);
        if (!payload || !ch || !('messages' in ch))
            continue;
        await ch.messages.edit(p.message_id, payload).catch(() => { });
    }
}
function adminWallets() {
    return wallets.listWallets();
}
async function userSummary(uid) {
    ensureUser(uid);
    const r = getReserves(uid);
    return { id: uid, pp: r.pp, ltc: r.ltc, banned: isBanned(uid) };
}
async function renderAdmin(i, screenName, notice) {
    const gid = i.guildId;
    const s = selOf(i.user.id);
    switch (screenName) {
        case 'games': return showAdmin(i, gamesScreen(gamePanels(gid), s, notice));
        case 'wallet': return showAdmin(i, walletScreen(adminWallets(), s.walletId, notice, await operatorWithdrawable()));
        case 'server': return showAdmin(i, serverHome(notice));
        case 'ng': return showAdmin(i, ngScreen(listBannedWords(gid).map(w => w.word), notice));
        case 'user': return showAdmin(i, userScreen(s.userId ? await userSummary(s.userId) : undefined, notice));
        case 'ops': return showAdmin(i, opsScreen(ach.getConfig(gid), notice));
        case 'sales': return showAdmin(i, salesScreen(salesSummary()));
        default: return showAdmin(i, adminHub());
    }
}
/** 売上: 確定した入金と、送り終えた出金の合計 (円)。月は日本時間で区切る。 */
function salesSummary() {
    const JST = 9 * 3600;
    const rows = (table) => {
        const [amount, done, at] = table === 'deposits'
            ? ['amount_jpy', `status='confirmed'`, 'COALESCE(confirmed_at, created_at)']
            : ['net_jpy', `status='sent'`, 'COALESCE(completed_at, created_at)'];
        return db.prepare(`SELECT strftime('%Y-%m', ${at} + ${JST}, 'unixepoch') AS month, method, COALESCE(SUM(${amount}),0) AS s
         FROM ${table} WHERE ${done} GROUP BY month, method`).all();
    };
    const months = new Map();
    const get = (m) => months.get(m) ?? (months.set(m, { depPaypay: 0, depLtc: 0, wdPaypay: 0, wdLtc: 0 }), months.get(m));
    for (const r of rows('deposits'))
        get(r.month)[r.method === 'paypay' ? 'depPaypay' : 'depLtc'] += r.s;
    for (const r of rows('withdrawals'))
        get(r.month)[r.method === 'paypay' ? 'wdPaypay' : 'wdLtc'] += r.s;
    const thisMonth = new Date(Date.now() + JST * 1000).toISOString().slice(0, 7);
    get(thisMonth); // 今月は取引が無くても出す
    return {
        months: [...months.entries()].sort((x, y) => y[0].localeCompare(x[0])).map(([month, p]) => ({ month, ...p })),
        userBalance: db.prepare('SELECT COALESCE(SUM(balance),0) s FROM users').get().s,
    };
}
/** 最近の入金 (別の画面に出す) */
async function replyRecentDeposits(i) {
    const rows = db.prepare(`SELECT id, discord_id, method, amount_jpy, status, created_at FROM deposits ORDER BY id DESC LIMIT 15`).all();
    const txt = rows.map(r => `<t:${r.created_at}:f> #${r.id} ${r.method === 'paypay' ? 'PayPay' : 'LTC'} <@${r.discord_id}> ¥${r.amount_jpy.toLocaleString()} — **${r.status}**`).join('\n') || '履歴なし';
    const embed = new EmbedBuilder().setTitle('最近の入金').setDescription(txt.slice(0, 4096)).setColor(0x4f46e5);
    return i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
async function onAdminPanel(i) {
    if (!i.guildId)
        return;
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
        return i.reply({ content: '管理パネルはサーバー管理権限のある人だけが使えます', flags: MessageFlags.Ephemeral });
    const [, sec, act, arg] = i.customId.split(':');
    const s = selOf(i.user.id);
    const gid = i.guildId;
    // チャンネルに常設している管理パネルの「一覧を更新」
    if (sec === 'land') {
        const payload = panelPayload(gid, `admin:${act}`);
        if (payload && i.isButton())
            return i.update(payload);
        return;
    }
    // 画面の切り替え
    if (sec === 'open') {
        if (act === 'leet')
            return onLeetButton(i);
        return renderAdmin(i, act);
    }
    /* ① ゲームパネル */
    if (sec === 'games') {
        if (act === 'kind' && i.isStringSelectMenu()) {
            s.kind = i.values[0];
            return renderAdmin(i, 'games');
        }
        if (act === 'channel' && i.isChannelSelectMenu()) {
            s.channelId = i.values[0];
            return renderAdmin(i, 'games');
        }
        if (act === 'install') {
            if (!s.kind || !s.channelId)
                return renderAdmin(i, 'games', { ok: false, text: '種類とチャンネルを選んでください' });
            if (isAdminPanelKey(s.kind))
                return renderAdmin(i, 'games', { ok: false, text: '管理パネルは /admin panel で設置してください' });
            await i.deferUpdate();
            const err = await installPanel(gid, s.channelId, s.kind);
            await refreshAdminLandings(gid, ['admin:games']);
            return renderAdmin(i, 'games', err ? { ok: false, text: err } : { ok: true, text: `${panelLabel(s.kind)} を <#${s.channelId}> に設置しました` });
        }
        if (act === 'reinstall') {
            const n = gamePanels(gid).length;
            return showAdmin(i, confirmScreen('全パネルを再設置', [`設置済みの ${n} 個のパネル (ゲーム・入出金・ルール説明など) を消して、同じチャンネルに置き直します`, '置き直したパネルは最新の見た目になります', '「(旧)」のパネルは置き直さずに消します', '管理パネルは対象外 (/admin panel で置き直す)'], 'ap:games:reinstallgo', 'ap:open:games'));
        }
        if (act === 'reinstallgo') {
            await i.deferUpdate();
            const rows = gamePanels(gid);
            const failed = [];
            let removed = 0;
            for (const p of rows) {
                if (isLegacyPanelKey(p.game)) { // 今は設置しない種類は消すだけ
                    const ch = await client.channels.fetch(p.channel_id).catch(() => null);
                    if (ch && 'messages' in ch)
                        await ch.messages.delete(p.message_id).catch(() => { });
                    db.prepare('DELETE FROM panels WHERE channel_id=? AND game=?').run(p.channel_id, p.game);
                    removed++;
                    continue;
                }
                const err = await installPanel(gid, p.channel_id, p.game);
                if (err)
                    failed.push(`${panelLabel(p.game)} (<#${p.channel_id}>): ${err}`);
            }
            await refreshAdminLandings(gid, ['admin:games']);
            const total = rows.length - removed;
            const gone = removed ? ` (旧) のパネル ${removed} 個は消しました。` : '';
            return renderAdmin(i, 'games', failed.length
                ? { ok: false, text: `${total - failed.length} / ${total} 個を置き直しました。${gone}失敗: ${failed.join(' / ')}` }
                : { ok: true, text: `${total} 個のパネルを置き直しました。${gone}` });
        }
    }
    /* ② ウォレット */
    if (sec === 'wallet') {
        if (act === 'pick' && i.isStringSelectMenu()) {
            s.walletId = Number(i.values[0]);
            return renderAdmin(i, 'wallet');
        }
        const w = s.walletId !== undefined ? wallets.getWallet(s.walletId) : undefined;
        if (act === 'enable' || act === 'disable') {
            if (!w)
                return renderAdmin(i, 'wallet', { ok: false, text: 'ウォレットを選んでください' });
            wallets.setEnabled(w.id, act === 'enable');
            invalidateLiquidityCache();
            await refreshAdminLandings(gid, ['admin:wallet']);
            return renderAdmin(i, 'wallet', { ok: true, text: `#${w.id} ${w.label} を${act === 'enable' ? '有効' : '無効'}にしました` });
        }
        if (act === 'remove') {
            if (!w)
                return renderAdmin(i, 'wallet', { ok: false, text: 'ウォレットを選んでください' });
            return showAdmin(i, confirmScreen('ウォレットを削除', [`#${w.id} ${w.label} (${w.kind === 'paypay' ? 'PayPay' : 'LTC'}) を削除します`, w.kind === 'paypay' ? 'ログイン情報も消えます' : '自動送金用の鍵も消えます'], 'ap:wallet:removego', 'ap:open:wallet'));
        }
        if (act === 'removego') {
            if (!w)
                return renderAdmin(i, 'wallet', { ok: false, text: 'ウォレットが見つかりません' });
            wallets.removeWallet(w.id);
            s.walletId = undefined;
            invalidateLiquidityCache();
            await refreshAdminLandings(gid, ['admin:wallet']);
            return renderAdmin(i, 'wallet', { ok: true, text: `#${w.id} ${w.label} を削除しました` });
        }
        if (act === 'balance') {
            if (!w)
                return renderAdmin(i, 'wallet', { ok: false, text: 'PayPay ウォレットを選んでください' });
            return cmdWallet(asCommand(i, 'balance', { id: w.id }));
        }
        if (act === 'refresh')
            return cmdPaypay(asCommand(i, 'balance'));
        if (act === 'addpp')
            return i.showModal(adminModal('wallet:paypay:start:', 'PayPay を登録', [
                ['label', '表示名 (例: メイン)'], ['phone', '電話番号 (ハイフン可)'], ['password', 'PayPay のパスワード'],
            ]));
        if (act === 'addltc')
            return i.showModal(adminModal('ap:wallet:addltcgo', 'LTC を登録', [
                ['label', '表示名 (例: メイン)'],
                ['address', '受け取り専用にするならアドレス', { required: false, placeholder: '空欄なら自動送金用のウォレットを新しく作る' }],
            ]));
        if (act === 'addltcgo' && i.isModalSubmit()) {
            const label = i.fields.getTextInputValue('label').trim();
            const address = i.fields.getTextInputValue('address').trim() || null;
            return cmdWallet(asCommand(i, 'add-ltc', { label, address }));
        }
        if (act === 'transfer')
            return i.showModal(adminModal('ap:wallet:transfergo', '利益を引き出す (PayPay)', [
                ['amount', '金額 (円)'], ['passcode', 'リンクのパスコード (4 桁、任意)', { required: false }],
            ]));
        if (act === 'transfergo' && i.isModalSubmit()) {
            const amount = parseStrictInt(i.fields.getTextInputValue('amount'));
            if (amount === null)
                return i.reply({ content: '金額は整数で入力してください', flags: MessageFlags.Ephemeral });
            const passcode = i.fields.getTextInputValue('passcode').trim() || null;
            return cmdPaypay(asCommand(i, 'transfer', { amount, wallet: w?.kind === 'paypay' ? w.id : null, passcode }));
        }
    }
    /* ③ サーバー管理: NG ワード */
    if (sec === 'ng') {
        if (act === 'add')
            return i.showModal(adminModal('ap:ng:addgo', 'NG ワードを追加', [['word', '追加する語 (60 文字まで)']]));
        if (act === 'remove')
            return i.showModal(adminModal('ap:ng:removego', 'NG ワードを削除', [['word', '削除する語 (一覧と同じ表記)']]));
        if (act === 'addgo' && i.isModalSubmit()) {
            const word = i.fields.getTextInputValue('word').trim();
            const r = addBannedWord(gid, word, i.user.id);
            return renderAdmin(i, 'ng', r.added ? { ok: true, text: `「${word}」を追加しました` } : { ok: false, text: `追加できませんでした: ${r.reason}` });
        }
        if (act === 'removego' && i.isModalSubmit()) {
            const word = i.fields.getTextInputValue('word').trim();
            return renderAdmin(i, 'ng', removeBannedWord(gid, word) ? { ok: true, text: `「${word}」を削除しました` } : { ok: false, text: `「${word}」は登録されていません` });
        }
    }
    /* ③ サーバー管理: ユーザー */
    if (sec === 'user') {
        if (act === 'pick' && i.isUserSelectMenu()) {
            s.userId = i.values[0];
            return renderAdmin(i, 'user');
        }
        if (!s.userId)
            return renderAdmin(i, 'user', { ok: false, text: 'ユーザーを選んでください' });
        const user = await client.users.fetch(s.userId);
        if (act === 'info')
            return cmdAdmin(asCommand(i, 'user', { user }));
        if (act === 'history')
            return cmdAdmin(asCommand(i, 'history', { user, type: 'all', limit: 20 }));
        if (act === 'unban') {
            await cmdAdmin(asCommand(i, 'unban', { user }));
            return;
        }
        if (act === 'ban')
            return i.showModal(adminModal('ap:user:bango', `BAN: ${user.username}`, [['reason', '理由 (任意)', { required: false }]]));
        if (act === 'bango' && i.isModalSubmit()) {
            return cmdAdmin(asCommand(i, 'ban', { user, reason: i.fields.getTextInputValue('reason').trim() || null }));
        }
        if (act === 'grant')
            return i.showModal(adminModal(`ap:user:grantgo:${arg}`, `chip 付与 (${arg === 'pp' ? 'PayPay' : 'LTC'} 由来)`, [
                ['amount', '金額 (マイナスで減らす)', { placeholder: '例: 1000 / -500' }], ['reason', '理由 (任意)', { required: false }],
            ]));
        if (act === 'grantgo' && i.isModalSubmit()) {
            const amount = parseStrictInt(i.fields.getTextInputValue('amount'));
            if (amount === null || amount === 0)
                return i.reply({ content: '金額は 0 以外の整数で入力してください', flags: MessageFlags.Ephemeral });
            return cmdAdmin(asCommand(i, 'grant', { user, rail: arg === 'ltc' ? 'ltc' : 'pp', amount, reason: i.fields.getTextInputValue('reason').trim() || null }));
        }
        if (act === 'sendpp')
            return i.showModal(adminModal('ap:user:sendppgo', `PayPay 手動送金: ${user.username}`, [
                ['amount', '金額 (円)'], ['passcode', 'リンクのパスコード (4 桁、任意)', { required: false }], ['reason', '理由 (任意)', { required: false }],
            ]));
        if (act === 'sendppgo' && i.isModalSubmit()) {
            const amount = parseStrictInt(i.fields.getTextInputValue('amount'));
            if (amount === null)
                return i.reply({ content: '金額は整数で入力してください', flags: MessageFlags.Ephemeral });
            return cmdAdmin(asCommand(i, 'send-paypay', { user, amount, passcode: i.fields.getTextInputValue('passcode').trim() || null, reason: i.fields.getTextInputValue('reason').trim() || null }));
        }
        if (act === 'sendltc')
            return i.showModal(adminModal('ap:user:sendltcgo', `LTC 手動送金: ${user.username}`, [
                ['dest', '送金先の LTC アドレス'], ['ltc', '送る量 (LTC)', { placeholder: '例: 0.05' }], ['reason', '理由 (任意)', { required: false }],
            ]));
        if (act === 'sendltcgo' && i.isModalSubmit()) {
            const ltc = Number(i.fields.getTextInputValue('ltc').trim());
            if (!Number.isFinite(ltc) || ltc <= 0)
                return i.reply({ content: 'LTC の量は 0 より大きい数で入力してください', flags: MessageFlags.Ephemeral });
            return cmdAdmin(asCommand(i, 'send-ltc', { user, dest: i.fields.getTextInputValue('dest').trim(), ltc, reason: i.fields.getTextInputValue('reason').trim() || null }));
        }
    }
    /* ③ サーバー管理: 運営データ */
    if (sec === 'ops') {
        if (act === 'stats')
            return cmdAdmin(asCommand(i, 'stats'));
        if (act === 'pending')
            return cmdAdmin(asCommand(i, 'pending', { method: null, limit: 10 }));
        if (act === 'deposits')
            return replyRecentDeposits(i);
        if (act === 'achch' && i.isChannelSelectMenu()) {
            const ch = i.channels.first();
            if (!ch || !('name' in ch))
                return renderAdmin(i, 'ops', { ok: false, text: 'チャンネルを選んでください' });
            const base = (ch.name ?? 'achievements').replace(/[-_ー]実績\d+件$/, '');
            ach.setConfig(gid, ch.id, base);
            try {
                const fetched = await client.channels.fetch(ch.id);
                if (fetched && 'setName' in fetched)
                    await fetched.setName(ach.formatChannelName(base, ach.countAchievements(gid)));
            }
            catch { /* 名前の変更は頻度制限に当たることがある */ }
            return renderAdmin(i, 'ops', { ok: true, text: `当選告知の投稿先を <#${ch.id}> にしました` });
        }
        if (act === 'achoff') {
            ach.setConfig(gid, null, null);
            return renderAdmin(i, 'ops', { ok: true, text: '当選告知を止めました' });
        }
    }
}
/* ────────────── CASHIER (ユーザー出金) ────────────── */
async function openPaypayWithdrawModal(i) {
    const modal = new ModalBuilder().setCustomId('wd:paypay').setTitle('PayPay 出金')
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amt').setLabel(`金額 (¥${MIN_WITHDRAW_JPY.paypay}〜 chip)`).setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pin').setLabel('リンクのパスコード (4桁, 任意)').setStyle(TextInputStyle.Short).setRequired(false)
        .setMinLength(4).setMaxLength(4)));
    await i.showModal(modal);
}
async function openLtcWithdrawModal(i) {
    const modal = new ModalBuilder().setCustomId('wd:ltc').setTitle('LTC 出金')
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amt').setLabel(`金額 (¥${MIN_WITHDRAW_JPY.ltc}〜 chip)`).setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('addr').setLabel('あなたの LTC 受取アドレス').setStyle(TextInputStyle.Short).setRequired(true)));
    await i.showModal(modal);
}
/* ────────────── CASHIER (ユーザー入金) ────────────── */
/** ctx (<game>[:<sub>]) はゲームのリザルト画面から来た入金のとき。完了画面に同じゲームの Replay を付ける。 */
async function onDepositButton(i, kind, ctx) {
    assertNotBanned(i.user.id);
    if (kind === 'open')
        return i.reply({ ...depositMethodPicker(ctx), flags: MessageFlags.Ephemeral });
    if (kind === 'paypay')
        return openPaypayDepositModal(i, ctx);
    if (kind === 'ltc')
        return showLtcAddress(i, ctx);
}
async function onWithdrawUserButton(i, kind) {
    assertNotBanned(i.user.id);
    if (kind === 'open')
        return i.reply({ ...withdrawMethodPicker(), flags: MessageFlags.Ephemeral });
    if (kind === 'paypay')
        return openPaypayWithdrawModal(i);
    if (kind === 'ltc')
        return openLtcWithdrawModal(i);
}
async function onSelect(i) {
    if (i.customId.startsWith('ap:'))
        return onAdminPanel(i);
    if (i.customId.startsWith('t:') || i.customId.startsWith('cr:add'))
        return onTableSelect(i);
    // 以前のルーレット画面に残っている掛け方メニュー: 新しいテーブルを開き直す
    if (i.customId === 'rou:select')
        return openTable(i, 'roulette');
}
/** 運営の受け取りウォレットが無い入金方法は、入力画面を開かずに知らせる */
const depositUnavailable = (i, method) => i.reply({ content: `${method} の入金は今は使えません (運営の受け取りウォレットが未登録)。`, flags: MessageFlags.Ephemeral });
const hasLtcWallet = () => operatorLtcAddress() !== null;
async function openPaypayDepositModal(i, ctx = '') {
    if (!wallets.pickPaypayWallet())
        return depositUnavailable(i, 'PayPay');
    const modal = new ModalBuilder().setCustomId(`dep:paypay${ctx ? `:${ctx}` : ''}`).setTitle('PayPay 送金リンク入金')
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('url').setLabel('送金リンク').setPlaceholder('https://pay.paypay.ne.jp/...').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pin').setLabel('パスコード (設定していれば)').setStyle(TextInputStyle.Short).setRequired(false)));
    await i.showModal(modal);
}
/** タップでコピーできる形 (インラインコード) にする。行ごとに囲み、2000 文字に収める。 */
function tapToCopy(text) {
    const out = [];
    let len = 0;
    for (const line of text.split('\n')) {
        // 中に ` があると囲みが閉じてしまうので、`` で囲む (前後の空白は表示されない)
        const piece = line.trim() === '' ? '' : line.includes('`') ? `\`\` ${line.replace(/``+/g, m => m.split('').join('\u200b'))} \`\`` : `\`${line}\``;
        if (len + piece.length + 1 > 2000)
            break;
        out.push(piece);
        len += piece.length + 1;
    }
    return out.join('\n') || '`(空)`';
}
/** LTC 選択時: 直接モーダルを開いて JPY を入力させる (空欄なら見積なしでアドレスだけ返す) */
async function showLtcAddress(i, ctx = '') {
    if (!hasLtcWallet())
        return depositUnavailable(i, 'LTC');
    const modal = new ModalBuilder().setCustomId(`dep:ltc${ctx ? `:${ctx}` : ''}`).setTitle('LTC 入金')
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('jpy').setLabel('入金する金額 (円)')
        .setStyle(TextInputStyle.Short).setPlaceholder('例: 5000').setRequired(true)));
    await i.showModal(modal);
}
async function replyLtcQuote(i, jpy, ctx = '') {
    const inPlace = !!ctx && i.isModalSubmit() && i.isFromMessage();
    if (inPlace && i.isModalSubmit() && i.isFromMessage())
        await i.deferUpdate();
    else
        await i.deferReply({ flags: MessageFlags.Ephemeral });
    const rows = ctx ? [replayRowFromCtx(ctx)] : [];
    const fail = (msg) => i.editReply({ content: msg, embeds: [], components: rows });
    const address = operatorLtcAddress();
    if (!address)
        return fail('LTC の入金は今は使えません (運営の受け取りウォレットが未登録)。');
    if (jpy === null || !Number.isFinite(jpy) || jpy <= 0)
        return fail('入金する金額 (円) を入力してください');
    if (jpy < MIN_DEPOSIT_JPY.ltc)
        return fail(`LTC の最低入金額は ¥${MIN_DEPOSIT_JPY.ltc.toLocaleString()} です`);
    if (jpy > 10_000_000)
        return fail('金額が大きすぎます');
    const rate = await ltcJpyRate().catch(() => null);
    if (!rate)
        return fail('LTC のレートを取得できませんでした。しばらくしてからやり直してください。');
    let req;
    try {
        req = ltcMatch.createRequest(i.user.id, address, jpy, rate);
    }
    catch (e) {
        return fail(e.message);
    }
    const ltc = ltcMatch.satToLtc(req.amount_sat);
    const uri = `litecoin:${address}?amount=${ltc}`;
    const block = (t) => '`' + t + '`'; // タップでコピーできる形
    const embed = panelEmbed({
        icon: ICON.ltc(), title: 'LTC 入金', tagline: '下の量をぴったり送ってください', color: COLOR.violet, deco: '',
        sections: [{ icon: ICON.crown(), title: '注意', lines: [
                    '1 桁でもずれると自動で反映できません。末尾の数字が、あなたの入金の目印です',
                    '取引所から送るときは、手数料が引かれたあとの受け取り量がこの量になるように送ってください',
                    `<t:${req.expires_at}:R> までに送ってください。期限を過ぎてから届いたものは自動では反映されません`,
                    `届いてから 3 承認 (約 8 分) で ¥${jpy.toLocaleString()} が残高に入り、DM でお知らせします`,
                    '新しく申請すると、前の申請の量は使えなくなります',
                ] }],
        footer: `1 LTC ≈ ¥${rate.toLocaleString()}`,
    });
    // 見出しのすぐ下に、コピーしやすいようコードブロックで送金先と量を入れる
    const [head, ...rest] = embed.data.description.split('\n\n');
    embed.setDescription([
        head,
        `### ${ICON.wallet()} 送金先\n${block(address)}`,
        `### ${ICON.ltc()} 送る量 (¥${jpy.toLocaleString()} 分)\n${block(ltc)}`,
        ...rest,
        `送金アプリ用のリンク\n${block(uri)}`,
    ].join('\n\n'));
    return i.editReply({ content: '', embeds: [embed], components: rows });
}
/** 運営の LTC 受け取りアドレス (有効なウォレットのうち、最初に登録したもの) */
function operatorLtcAddress() {
    return wallets.listWallets('ltc').filter(w => w.enabled).sort((a, b) => a.id - b.id)[0]?.address ?? null;
}
async function processPaypayDeposit(discordId, linkInput, passcode) {
    // 受け付けるのは送金リンクだけ (https://pay.paypay.ne.jp/...)
    const link = linkInput.trim();
    if (!link.startsWith('https://pay.paypay.ne.jp/'))
        throw new Error('PayPay の送金リンク (https://pay.paypay.ne.jp/...) を貼ってください');
    const code = pp.extractLinkId(link);
    if (!code)
        throw new Error('PayPay 送金リンクを認識できませんでした');
    const w = wallets.pickPaypayWallet();
    if (!w)
        throw new Error('有効な PayPay 受取ウォレットが登録されていません。管理者に連絡してください。');
    // 重複受領ガード
    const dup = db.prepare('SELECT 1 FROM deposits WHERE tx_ref=?').get(code);
    if (dup)
        throw new Error('この送金リンクは既に処理済みです');
    // ログイン不要の check で先に状態を見る
    const pre = await pp.linkCheck(code).catch(() => null);
    if (pre && pre.status !== 'PENDING')
        throw new Error(`リンク状態: ${pre.status}`);
    if (pre && pre.amount < MIN_DEPOSIT_JPY.paypay)
        throw new Error(`最低入金額は ¥${MIN_DEPOSIT_JPY.paypay.toLocaleString()} です (このリンクは ¥${pre.amount.toLocaleString()})`);
    const r = await wallets.withPaypay(w, t => pp.linkReceive(t, code, passcode));
    wallets.adjustCached(w.id, r.amount); // 運営 PayPay 残高を即時 +r.amount に更新
    const stmt = db.prepare(`INSERT INTO deposits(discord_id, method, amount_jpy, amount_raw, tx_ref, status, confirmed_at)
    VALUES (?, 'paypay', ?, ?, ?, 'confirmed', strftime('%s','now'))`);
    stmt.run(discordId, r.amount, String(r.amount), code);
    creditRail(discordId, 'pp', r.amount, 'deposit:paypay', code);
    invalidateLiquidityCache();
    return { amount: r.amount, wallet: w.label };
}
/* ────────────── MODAL ────────────── */
/* ────────────── LEET convert button ────────────── */
async function onLeetButton(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
        return i.reply({ content: '権限が不足しています', flags: MessageFlags.Ephemeral });
    return i.showModal(leetModal());
}
/** LEET 変換の入力画面 (/leet と、以前設置した LEET パネルのボタンで使う) */
function leetModal() {
    return new ModalBuilder().setCustomId('leet:input').setTitle('LEET 変換')
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('text')
        .setLabel('変換する文字列 (アルファベットが対象)')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1800)
        .setRequired(true)));
}
async function onModal(i) {
    if (i.customId === 'leet:input') {
        if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
            return i.reply({ content: '権限が不足しています', flags: MessageFlags.Ephemeral });
        const src = i.fields.getTextInputValue('text');
        // スマホの Discord は ` 1 つで囲んだ部分 (インラインコード) をタップでコピーできる。
        // ``` のコードブロックはタップしてもコピーされないので使わない。改行をまたげないため 1 行ずつ囲む。
        return i.reply({ content: tapToCopy(L(src)), flags: MessageFlags.Ephemeral });
    }
    if (i.customId.startsWith('t:'))
        return onTableModal(i);
    if (i.customId.startsWith('ap:'))
        return onAdminPanel(i);
    if (i.customId === 'dep:ltc' || i.customId.startsWith('dep:ltc:')) {
        assertNotBanned(i.user.id);
        const raw = i.fields.getTextInputValue('jpy').replace(/[,\s¥]/g, '');
        const jpy = raw === '' ? null : parseInt(raw, 10);
        return replyLtcQuote(i, jpy, i.customId.split(':').slice(2).join(':'));
    }
    if (i.customId.startsWith('wd:approve:')) {
        if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
            return i.reply({ content: '権限不足', flags: MessageFlags.Ephemeral });
        const id = parseInt(i.customId.split(':')[2], 10);
        const txid = i.fields.getTextInputValue('txid').trim();
        try {
            const w = withdraw.markLtcSent(id, txid);
            await i.reply({ content: `✅ LTC 出金 #${id} 完了 (txid=${txid.slice(0, 16)}…)`, flags: MessageFlags.Ephemeral });
            const user = await client.users.fetch(w.discord_id).catch(() => null);
            await user?.send(`✅ LTC 出金 #${id} 送信完了。\ntxid: \`${txid}\``).catch(() => { });
        }
        catch (e) {
            await i.reply({ content: `❌ ${e.message}`, flags: MessageFlags.Ephemeral });
        }
        return;
    }
    if (i.customId === 'wd:paypay') {
        assertNotBanned(i.user.id);
        const amt = parseStrictInt(i.fields.getTextInputValue('amt'));
        if (amt === null)
            return i.reply({ content: '金額は整数で入力してください', flags: MessageFlags.Ephemeral });
        const pin = i.fields.getTextInputValue('pin').trim() || undefined;
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const r = await withdraw.withdrawPayPay(client, { discordId: i.user.id, method: 'paypay', amountJpy: amt, passcode: pin });
            invalidateLiquidityCache();
            await i.editReply(`✅ PayPay 出金 #${r.id} 受付完了。送金リンクを DM 送信しました。`);
        }
        catch (e) {
            await i.editReply(`❌ ${e.message}`);
        }
    }
    if (i.customId === 'wd:ltc') {
        assertNotBanned(i.user.id);
        const amt = parseStrictInt(i.fields.getTextInputValue('amt'));
        if (amt === null)
            return i.reply({ content: '金額は整数で入力してください', flags: MessageFlags.Ephemeral });
        const addr = i.fields.getTextInputValue('addr').trim();
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const adminCh = i.guildId ? getAdminChannel(i.guildId) : null;
            const r = await withdraw.withdrawLtc(client, adminCh, { discordId: i.user.id, method: 'ltc', amountJpy: amt, dest: addr });
            invalidateLiquidityCache();
            if (r.auto && r.txid) {
                await i.editReply(`✅ LTC 出金 #${r.id} 送信完了\n` +
                    `**${r.ltcAmount} LTC** → \`${addr}\`\n` +
                    `txid: \`${r.txid}\`  (ネットワーク反映まで数分〜十数分)`);
            }
            else {
                await i.editReply(`✅ LTC 出金 #${r.id} 受付完了\n` +
                    `**${r.ltcAmount} LTC** → \`${addr}\`\n` +
                    `処理には少し時間がかかります。完了次第 DM で txid をお知らせします。`);
            }
        }
        catch (e) {
            await i.editReply(`❌ ${e.message}`);
        }
    }
    if (i.customId === 'dep:paypay' || i.customId.startsWith('dep:paypay:')) {
        assertNotBanned(i.user.id);
        const ctx = i.customId.split(':').slice(2).join(':');
        const url = i.fields.getTextInputValue('url');
        const pin = i.fields.getTextInputValue('pin').trim() || undefined;
        // ゲームから来た入金は、入金方法の選択画面をそのまま完了画面に書き換えて Replay を付ける
        const inPlace = !!ctx && i.isFromMessage();
        if (inPlace && i.isFromMessage())
            await i.deferUpdate();
        else
            await i.deferReply({ flags: MessageFlags.Ephemeral });
        const rows = ctx ? [replayRowFromCtx(ctx)] : [];
        try {
            const r = await processPaypayDeposit(i.user.id, url, pin);
            await i.editReply({ content: `✅ PayPay ¥${r.amount.toLocaleString()} を受領（wallet: \`${r.wallet}\`）。残高に加算しました。`, embeds: [], components: rows });
        }
        catch (e) {
            await i.editReply({ content: `❌ ${e.message}`, embeds: [], components: rows });
        }
    }
    if (i.customId.startsWith('wallet:paypay:start:')) {
        if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
            return i.reply({ content: '権限不足', flags: MessageFlags.Ephemeral });
        const label = decodeURIComponent(i.customId.split(':')[3] ?? '') || i.fields.getTextInputValue('label').trim() || 'PayPay';
        const phone = i.fields.getTextInputValue('phone');
        const password = i.fields.getTextInputValue('password');
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const r = await pp.loginStart(phone, password);
            paypayLoginFlow.set(i.user.id, { sess: r.session, label, phone });
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('wallet:paypay:url').setLabel('SMS の URL を入力').setStyle(ButtonStyle.Primary));
            await i.editReply({ content: `📱 SMS を送信しました。届いた URL (またはIDのみ) を次で入力してください。`, components: [row] });
        }
        catch (e) {
            await i.editReply(`❌ ${e.message}`);
        }
    }
    if (i.customId === 'wallet:paypay:finish') {
        const url = i.fields.getTextInputValue('url').trim();
        const flow = paypayLoginFlow.get(i.user.id);
        if (!flow)
            return i.reply({ content: 'ログインフローが見つかりません。最初からやり直してください。', flags: MessageFlags.Ephemeral });
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const tokens = await pp.loginFinish(flow.sess, url);
            const id = wallets.addPaypayWallet(i.user.id, flow.label, flow.phone, tokens);
            paypayLoginFlow.delete(i.user.id);
            if (i.guildId)
                await refreshAdminLandings(i.guildId, ['admin:wallet']);
            await i.editReply(`✅ PayPay ウォレット追加 (#${id}) — ${tokens.name ?? 'account'} として登録`);
        }
        catch (e) {
            await i.editReply(`❌ ${e.message}`);
        }
    }
}
// PayPay URL 入力ボタン → モーダル
client.on(Events.InteractionCreate, async (i) => {
    if (!i.isButton() || i.customId !== 'wallet:paypay:url')
        return;
    const modal = new ModalBuilder().setCustomId('wallet:paypay:finish').setTitle('PayPay SMS URL 入力')
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('url').setLabel('SMS 内の URL または ID').setStyle(TextInputStyle.Short).setRequired(true)));
    await i.showModal(modal);
});
/* ────────────── LTC 入金ポーリング ────────────── */
async function ltcPoll() {
    await pollOperatorLtc().catch(e => console.error('[ltc-poll] operator:', e.message));
    if (!process.env.LTC_API_TOKEN)
        return;
    // 以前の仕組み (ユーザーごとのアドレス) に送られた分も、引き続き反映する
    const rows = db.prepare('SELECT discord_id, address FROM ltc_addresses').all();
    const rate = await ltcJpyRate().catch(() => null);
    if (!rate)
        return;
    for (const row of rows) {
        const txs = await checkDeposits(row.address).catch(() => []);
        for (const tx of txs) {
            const exists = db.prepare('SELECT 1 FROM deposits WHERE tx_ref=?').get(tx.txid);
            if (exists)
                continue;
            const jpy = Math.floor(tx.value_ltc * rate);
            if (jpy < MIN_DEPOSIT_JPY.ltc) {
                console.warn(`[ltc-poll] ${tx.txid} too small: ¥${jpy} < ¥${MIN_DEPOSIT_JPY.ltc}`);
                // 最低額未満は無視 (ユーザーには DM で通知)
                const user = await client.users.fetch(row.discord_id).catch(() => null);
                await user?.send(`⚠️ LTC ${tx.value_ltc} (≈ ¥${jpy.toLocaleString()}) を検出しましたが、最低入金額 ¥${MIN_DEPOSIT_JPY.ltc.toLocaleString()} 未満のため処理されませんでした。`).catch(() => { });
                db.prepare(`INSERT INTO deposits(discord_id, method, amount_jpy, amount_raw, tx_ref, status, confirmed_at)
          VALUES (?, 'ltc', ?, ?, ?, 'rejected', strftime('%s','now'))`)
                    .run(row.discord_id, jpy, String(tx.value_ltc), tx.txid);
                continue;
            }
            try {
                db.prepare(`INSERT INTO deposits(discord_id, method, amount_jpy, amount_raw, tx_ref, status, confirmed_at)
          VALUES (?, 'ltc', ?, ?, ?, 'confirmed', strftime('%s','now'))`)
                    .run(row.discord_id, jpy, String(tx.value_ltc), tx.txid);
                creditRail(row.discord_id, 'ltc', jpy, 'deposit:ltc', tx.txid);
                invalidateLiquidityCache();
                const user = await client.users.fetch(row.discord_id).catch(() => null);
                await user?.send(`✅ LTC ${tx.value_ltc} (≈ ¥${jpy.toLocaleString()}) を受信。残高に加算しました。`).catch(() => { });
            }
            catch { /* dup */ }
        }
    }
}
setInterval(ltcPoll, 60_000);
/** 運営の LTC アドレスに届いた送金を、申請した量と照らし合わせて残高に反映する */
async function pollOperatorLtc() {
    const ltcWallets = wallets.listWallets('ltc').filter(w => w.enabled && w.address);
    const addresses = [...new Set(ltcWallets.map(w => w.address))];
    const rate = await ltcJpyRate().catch(() => null);
    for (const address of addresses) {
        const full = await addressFull(address).catch(e => { console.error('[ltc-poll]', address, e.message); return null; });
        if (!full)
            continue;
        // 実際の残高を最新のレートで円に直して記録する (Bot の外でお金が動いても、LTC の値動きがあっても合わせる)
        if (rate) {
            for (const w of ltcWallets.filter(x => x.address === address))
                wallets.setCached(w.id, Math.floor(full.balanceSat / 1e8 * rate));
            invalidateLiquidityCache();
        }
        if (!process.env.LTC_API_TOKEN)
            continue; // 入金の照合は今までどおり API トークンがあるときだけ
        const since = ltcMatch.firstRequestAt(address);
        if (since === null)
            continue; // まだ申請が無いアドレスは見ない
        for (const tx of full.incoming) {
            if (tx.receivedAt < since - 120)
                continue; // 申請を受け付ける前からの送金は対象外
            if (db.prepare('SELECT 1 FROM deposits WHERE tx_ref=?').get(tx.txid))
                continue;
            if (db.prepare('SELECT 1 FROM ltc_unmatched WHERE txid=?').get(tx.txid))
                continue;
            const req = ltcMatch.findRequest(address, tx.valueSat, tx.receivedAt);
            if (!req) {
                db.prepare('INSERT OR IGNORE INTO ltc_unmatched(txid, address, amount_sat) VALUES (?,?,?)').run(tx.txid, address, tx.valueSat);
                await notifyServerPanels(ltcUnmatchedEmbed(address, tx.txid, tx.valueSat));
                continue;
            }
            // 申請時のレートで決めた円と、今のレートで換算した円のうち、小さい方を credit する。
            // レートが下がったときだけ送って運営の LTC を安く買う "無料の put" を防ぐ。
            // 市況レートが取れないときは申請の円を使う (レートが取れないのに credit を止めると入金が詰まるため)。
            const marketJpy = rate ? Math.floor((tx.valueSat / 1e8) * rate) : null;
            const credited = marketJpy !== null ? Math.min(req.jpy, marketJpy) : req.jpy;
            try {
                db.transaction(() => {
                    db.prepare(`INSERT INTO deposits(discord_id, method, amount_jpy, amount_raw, tx_ref, status, confirmed_at)
            VALUES (?, 'ltc', ?, ?, ?, 'confirmed', strftime('%s','now'))`)
                        .run(req.discord_id, credited, String(tx.valueSat), tx.txid);
                    ltcMatch.markCredited(req.id, tx.txid);
                    creditRail(req.discord_id, 'ltc', credited, 'deposit:ltc', tx.txid);
                })();
            }
            catch (e) {
                console.error('[ltc-poll] credit failed:', tx.txid, e.message);
                continue;
            }
            invalidateLiquidityCache();
            const user = await client.users.fetch(req.discord_id).catch(() => null);
            await user?.send(`LTC ${ltcMatch.satToLtc(tx.valueSat)} の着金を確認しました。¥${credited.toLocaleString()} を残高に加えました。`).catch(() => { });
        }
    }
}
/** サーバー管理パネルを置いたチャンネルに知らせる */
async function notifyServerPanels(embed) {
    for (const channelId of serverPanelChannels()) {
        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (ch && 'send' in ch)
            await ch.send({ embeds: [embed] }).catch(() => { });
    }
}
/* ────────────── PayPay 定期残高同期 ────────────── */
/** 5 分ごとに運営 PayPay ウォレットの残高を実 API と同期する。
 *  balance_cached は入出金の都度 adjustCached で即時更新しているので、
 *  この定期同期はドリフト修正用。 */
async function paypayPeriodicSync() {
    const rows = wallets.listWallets('paypay').filter(w => w.enabled && w.access_token);
    for (const w of rows) {
        try {
            const b = await wallets.withPaypay(w, t => pp.walletBalance(t));
            wallets.setCached(w.id, b.usable_balance);
        }
        catch (e) {
            console.warn(`[paypay-sync] #${w.id}:`, e.message);
        }
    }
    invalidateLiquidityCache();
}
setInterval(paypayPeriodicSync, 5 * 60_000);
// 起動直後にも 1 回
setTimeout(paypayPeriodicSync, 10_000);
client.login(process.env.DISCORD_TOKEN);
