import 'dotenv/config';
import {
  Client, GatewayIntentBits, Partials, AttachmentBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, ActionRowBuilder, Events, PermissionFlagsBits,
  EmbedBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction,
  ButtonInteraction, ModalSubmitInteraction, StringSelectMenuInteraction, MessageFlags,
} from 'discord.js';
import { db, getBalance, txCredit, ensureUser, isBanned, assertNotBanned, creditRail, getReserves, applyMix, payoutByMix } from './db/schema.js';
import type { BetMix } from './games/session-store.js';
import * as sessions from './games/session-store.js';
import { startHand, availableActions, apply, newShoe, isBlackjack, handTotal, type BJState } from './games/blackjack.js';
import { spin, spinWithCap, reelStrip } from './games/slots.js';
import { spinRoulette, spinRouletteWithCap, payoutMult as rouPayout, WHEEL, type BetKind as RouKind } from './games/roulette.js';
import { dealBaccarat, dealBaccaratWithCap, payoutMult as bacPayout, type Side as BacSide } from './games/baccarat.js';
import { startVP, drawVP, drawVPWithCap, payoutFor, type VPHand } from './games/videopoker.js';
import { newCraps, addBet, roll as crapsRoll, openExposure, type CrapsBetKind, type CrapsState, type CrapsBet } from './games/craps.js';
import { renderBlackjack } from './ui/render-table.js';
import { renderSlots } from './ui/render-slots.js';
import { renderRoulette } from './ui/render-roulette.js';
import { renderBaccarat } from './ui/render-baccarat.js';
import { renderVideoPoker } from './ui/render-videopoker.js';
import { renderCraps } from './ui/render-craps.js';
import { blackjackPanel, slotsPanel, roulettePanel, rouletteBetSelectRow, baccaratPanel, videopokerPanel, vpHoldRow, crapsPanel, crapsControlRows, depositPanel, bjActionsRow, balanceReply, bjPlayPanel, slotsPlayPanel, vpPlayPanel, roulettePlayPanel, baccaratPlayPanel, crapsPlayPanel, leetPanel } from './ui/panels.js';
import * as pp from './payments/paypay-client.js';
import * as wallets from './payments/wallets.js';
import { getOrCreateAddress, checkDeposits, ltcJpyRate } from './payments/ltc.js';
import { housePayoutCap, clampPayout, setCrapsExposure, clearCrapsExposure, invalidateLiquidityCache, maxAffordableBet, assertOperatorWithdrawSafe } from './payments/liquidity.js';
import { MIN_DEPOSIT_JPY, MIN_WITHDRAW_JPY } from './payments/limits.js';
import * as withdraw from './payments/withdraw.js';
import { L } from './ui/leet.js';
import { gameOverview, type GameKey } from './ui/overview.js';
import * as ach from './achievements.js';
import {
  removeGuildAutoMod, removeAutoModInAllGuilds, AUTOMOD_RULE_NAME,
  listBannedWords, addBannedWord, removeBannedWord, getExtraKeywords, BUILTIN_KEYWORDS,
} from './moderation/automod.js';
import { installFilter } from './moderation/filter.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,       // NG ワード書き換えのため (privileged)
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
  try { db.exec(`ALTER TABLE guild_config ADD COLUMN ${col}`); } catch { /* exists */ }
}

function getAdminChannel(guildId: string): string | null {
  const r = db.prepare('SELECT admin_channel_id FROM guild_config WHERE guild_id=?').get(guildId) as { admin_channel_id: string } | undefined;
  return r?.admin_channel_id ?? null;
}

// PayPay ログイン進行状態 (discordUserId -> { sidecarSession, label, phone, guildId })
const paypayLoginFlow = new Map<string, { sess: string; label: string; phone: string }>();

client.once(Events.ClientReady, async c => {
  console.log(`[bot] online as ${c.user.tag}`);
  // Webhook rewrite 方式に切り替えたため、旧 AutoMod ブロックルールが残っていたら削除する
  try { await removeAutoModInAllGuilds(c as unknown as { guilds: { cache: Map<string, any> } }); }
  catch (e) { console.error('[automod] cleanup failed:', (e as Error).message); }
});

client.on(Events.GuildCreate, async g => {
  // 旧ルールが入っていたら削除
  try { await removeGuildAutoMod(g); } catch { /* best-effort */ }
});

client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isChatInputCommand()) await onCommand(i);
    else if (i.isButton()) await onButton(i);
    else if (i.isModalSubmit()) await onModal(i);
    else if (i.isStringSelectMenu()) await onSelect(i);
  } catch (e) {
    console.error(e);
    const msg = `❌ ${(e as Error).message}`;
    if (i.isRepliable()) {
      if (i.replied || i.deferred) await i.followUp({ content: msg, flags: MessageFlags.Ephemeral }).catch(()=>{});
      else await i.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(()=>{});
    }
  }
});

/* ────────────── COMMANDS ────────────── */

async function onCommand(i: ChatInputCommandInteraction) {
  switch (i.commandName) {
    case 'setup':    return cmdSetup(i);
    case 'balance':  return cmdBalance(i);
    case 'wallet':   return cmdWallet(i);
    case 'admin':    return cmdAdmin(i);
    case 'pay':      return cmdPay(i);
    case 'withdraw': return cmdWithdraw(i);
    case 'overview': return cmdOverview(i);
    case 'banned-words': return cmdBannedWords(i);
    case 'paypay':       return cmdPaypay(i);
    case 'leet':         return cmdLeet(i);
    case 'blackjack':  return installPlayPanel(i, 'blackjack');
    case 'slots':      return installPlayPanel(i, 'slots');
    case 'roulette':   return installPlayPanel(i, 'roulette');
    case 'baccarat':   return installPlayPanel(i, 'baccarat');
    case 'videopoker': return installPlayPanel(i, 'videopoker');
    case 'craps':      return installPlayPanel(i, 'craps');
  }
}

/* ────────────── /GAME: install Play panel ────────────── */

async function installPlayPanel(i: ChatInputCommandInteraction, game: 'blackjack'|'slots'|'roulette'|'baccarat'|'videopoker'|'craps') {
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageChannels))
    return i.reply({ content: '権限が不足しています', flags: MessageFlags.Ephemeral });
  if (!i.channel || !('send' in i.channel)) return i.reply({ content: 'このチャンネルには設置できません', flags: MessageFlags.Ephemeral });
  const payload = game === 'blackjack'  ? bjPlayPanel()
               : game === 'slots'      ? slotsPlayPanel()
               : game === 'roulette'   ? roulettePlayPanel()
               : game === 'baccarat'   ? baccaratPlayPanel()
               : game === 'videopoker' ? vpPlayPanel()
               : crapsPlayPanel();
  const msg = await i.channel.send(payload);
  db.prepare('INSERT OR REPLACE INTO panels(guild_id,channel_id,message_id,game) VALUES (?,?,?,?)')
    .run(i.guildId!, i.channelId, msg.id, game);
  await i.reply({ content: `✅ ${game} 卓を設置しました`, flags: MessageFlags.Ephemeral });
}

async function cmdBannedWords(i: ChatInputCommandInteraction) {
  if (!i.guild) return i.reply({ content: 'ギルド内で実行してください', flags: MessageFlags.Ephemeral });
  const sub = i.options.getSubcommand();

  if (sub === 'add') {
    const word = i.options.getString('word', true);
    const r = addBannedWord(i.guild.id, word, i.user.id);
    if (!r.added) return i.reply({ content: `⚠️ 追加失敗: ${r.reason}`, flags: MessageFlags.Ephemeral });
    return i.reply({ content: `✅ \`${word}\` を NG ワードに追加しました (次の投稿から即反映、伏字化されます)`, flags: MessageFlags.Ephemeral });
  }

  if (sub === 'remove') {
    const word = i.options.getString('word', true);
    const ok = removeBannedWord(i.guild.id, word);
    if (!ok) return i.reply({ content: `⚠️ \`${word}\` は登録されていません`, flags: MessageFlags.Ephemeral });
    return i.reply({ content: `🗑️ \`${word}\` を NG ワードから削除しました`, flags: MessageFlags.Ephemeral });
  }

  if (sub === 'list') {
    const custom = listBannedWords(i.guild.id);
    const customLines = custom.length
      ? custom.map(r => `\`${r.word}\`  — <@${r.added_by}>  <t:${r.created_at}:R>`).join('\n')
      : '_(なし)_';
    const builtinPreview = BUILTIN_KEYWORDS.slice(0, 30).map(w => `\`${w}\``).join(', ')
      + (BUILTIN_KEYWORDS.length > 30 ? ` … (計 ${BUILTIN_KEYWORDS.length} 語)` : '');
    const embed = new EmbedBuilder()
      .setTitle('🚫 NG ワード一覧')
      .setColor(0xd4af37)
      .addFields(
        { name: `📝 カスタム (${custom.length})`, value: customLines.slice(0, 1024), inline: false },
        { name: `🔒 内蔵 (${BUILTIN_KEYWORDS.length})`, value: builtinPreview.slice(0, 1024), inline: false },
      )
      .setFooter({ text: '内蔵語は編集不可 / 変種は regex で別途カバー' });
    return i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}

async function cmdWithdraw(i: ChatInputCommandInteraction) {
  assertNotBanned(i.user.id);
  const method = i.options.getString('method', true) as 'paypay' | 'ltc';
  if (method === 'paypay') return openPaypayWithdrawModal(i);
  return openLtcWithdrawModal(i);
}

async function cmdOverview(i: ChatInputCommandInteraction) {
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageChannels))
    return i.reply({ content: '権限が不足しています', flags: MessageFlags.Ephemeral });
  if (!i.channel || !('send' in i.channel))
    return i.reply({ content: 'このチャンネルには設置できません', flags: MessageFlags.Ephemeral });
  const g = i.options.getString('game', true) as GameKey;
  await i.channel.send({ embeds: [gameOverview(g)] });
  await i.reply({ content: `✅ ${g} 概要パネルを設置しました`, flags: MessageFlags.Ephemeral });
}

async function cmdPay(i: ChatInputCommandInteraction) {
  assertNotBanned(i.user.id);
  const method = i.options.getString('method', true) as 'paypay' | 'ltc';
  if (method === 'paypay') return openPaypayDepositModal(i);
  if (method === 'ltc') {
    const amount = i.options.getInteger('amount');
    if (amount && amount > 0) return replyLtcQuote(i, amount);
    // amount 省略 → モーダルで JPY 入力を促す
    return showLtcAddress(i);
  }
}

async function cmdSetup(i: ChatInputCommandInteraction) {
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageChannels))
    return i.reply({ content: '権限が不足しています', flags: MessageFlags.Ephemeral });
  const game = i.options.getString('game', true);
  const payload = game === 'blackjack'   ? blackjackPanel()
               : game === 'slots'       ? slotsPanel()
               : game === 'roulette'    ? roulettePanel()
               : game === 'baccarat'    ? baccaratPanel()
               : game === 'videopoker'  ? videopokerPanel()
               : game === 'craps'       ? crapsPanel()
               : depositPanel();
  if (!i.channel || !('send' in i.channel)) return i.reply({ content: 'このチャンネルには設置できません', flags: MessageFlags.Ephemeral });
  const msg = await i.channel.send(payload);
  db.prepare('INSERT OR REPLACE INTO panels(guild_id,channel_id,message_id,game) VALUES (?,?,?,?)')
    .run(i.guildId!, i.channelId, msg.id, game);
  await i.reply({ content: `✅ ${game} パネルを設置`, flags: MessageFlags.Ephemeral });
}

async function cmdBalance(i: ChatInputCommandInteraction) {
  const r = getReserves(i.user.id);
  const payload = await balanceReply(r.pp, r.ltc);
  await i.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

/* ────────────── /leet (admin LEET converter panel) ────────────── */

async function cmdLeet(i: ChatInputCommandInteraction) {
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
    return i.reply({ content: '権限が不足しています', flags: MessageFlags.Ephemeral });
  if (!i.channel || !('send' in i.channel)) return i.reply({ content: 'このチャンネルには設置できません', flags: MessageFlags.Ephemeral });
  const msg = await i.channel.send(leetPanel());
  db.prepare('INSERT OR REPLACE INTO panels(guild_id,channel_id,message_id,game) VALUES (?,?,?,?)')
    .run(i.guildId!, i.channelId, msg.id, 'leet');
  await i.reply({ content: '✅ LEET 変換パネルを設置しました', flags: MessageFlags.Ephemeral });
}

/* ────────────── /paypay (admin direct ops) ────────────── */

async function cmdPaypay(i: ChatInputCommandInteraction) {
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
    return i.reply({ content: '権限が不足しています', flags: MessageFlags.Ephemeral });
  const sub = i.options.getSubcommand();

  if (sub === 'login') {
    const label = i.options.getString('label', true);
    const modal = new ModalBuilder().setCustomId(`wallet:paypay:start:${encodeURIComponent(label)}`).setTitle('PayPay ログイン')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('phone').setLabel('電話番号 (ハイフン可)').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('password').setLabel('PayPay パスワード').setStyle(TextInputStyle.Short).setRequired(true)),
      );
    return i.showModal(modal);
  }

  if (sub === 'balance') {
    const rows = wallets.listWallets('paypay');
    if (!rows.length) return i.reply({ content: 'PayPay ウォレット未登録', flags: MessageFlags.Ephemeral });
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const lines: string[] = [];
    let total = 0;
    for (const w of rows) {
      const flag = w.enabled ? '🟢' : '⚪';
      if (!w.access_token) { lines.push(`${flag} **#${w.id}** \`${w.label}\` — 未ログイン`); continue; }
      try {
        const b = await wallets.withPaypay(w, t => pp.walletBalance(t));
        wallets.touchUsed(w.id, b.usable_balance);
        total += b.usable_balance;
        lines.push(`${flag} **#${w.id}** \`${w.label}\` (${w.display_name ?? '-'})\n` +
          `    usable: **¥${b.usable_balance.toLocaleString()}** / all: ¥${b.all_balance.toLocaleString()} / pt: ${b.points}`);
      } catch (e: any) {
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
    if (amount < 1) return i.reply({ content: '金額は 1 円以上', flags: MessageFlags.Ephemeral });

    await i.deferReply({ flags: MessageFlags.Ephemeral });

    // ウォレット選択: 指定があればそれを、無ければ balance_cached が足りる最も残量が多いものを
    let w: ReturnType<typeof wallets.getWallet> | undefined;
    if (walletId !== null) {
      w = wallets.getWallet(walletId);
      if (!w || w.kind !== 'paypay') return i.editReply(`❌ wallet #${walletId} は PayPay ウォレットではありません`);
      if (!w.enabled) return i.editReply(`❌ wallet #${walletId} は無効化されています`);
    } else {
      const candidates = wallets.listWallets('paypay')
        .filter(x => x.enabled && x.access_token && (x.balance_cached ?? 0) >= amount)
        .sort((a, b) => (b.balance_cached ?? 0) - (a.balance_cached ?? 0));
      w = candidates[0];
      if (!w) return i.editReply(`❌ ¥${amount.toLocaleString()} を送れるウォレットがありません (残高キャッシュ未更新の可能性: /paypay balance で更新)`);
    }

    // Solvency ガード: 引き出し後も流通チップを払えるか検査
    const bad = await assertOperatorWithdrawSafe(amount, 'paypay');
    if (bad) return i.editReply(`❌ 引き出し拒否: ${bad}`);

    const row = db.prepare(`INSERT INTO operator_payouts(admin_id, wallet_id, amount_jpy, passcode, status)
      VALUES (?, ?, ?, ?, 'pending')`).run(i.user.id, w.id, amount, passcode ?? null);
    const opId = row.lastInsertRowid as number;

    let link;
    try {
      link = await wallets.withPaypay(w, t => pp.createLink(t, amount, passcode));
    } catch (e: any) {
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
      .addFields(
        { name: 'From wallet', value: `#${w.id} \`${w.label}\``, inline: true },
        { name: 'Amount', value: `¥${amount.toLocaleString()}`, inline: true },
        ...(passcode ? [{ name: 'Passcode', value: `\`${passcode}\``, inline: true }] : []),
        { name: 'Link', value: link.link, inline: false },
      )
      .setFooter({ text: '7 日以内に受取ってください / 受取側アカウントが同じでも OK' });
    return i.editReply({ embeds: [embed] });
  }
}

/* ────────────── WALLET ADMIN ────────────── */

async function cmdWallet(i: ChatInputCommandInteraction) {
  const sub = i.options.getSubcommand();
  if (sub === 'add-paypay') {
    const label = i.options.getString('label', true);
    const modal = new ModalBuilder().setCustomId(`wallet:paypay:start:${encodeURIComponent(label)}`).setTitle('PayPay ログイン')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('phone').setLabel('電話番号 (ハイフン可)').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('password').setLabel('PayPay パスワード').setStyle(TextInputStyle.Short).setRequired(true)),
      );
    return i.showModal(modal);
  }
  if (sub === 'add-ltc') {
    const label = i.options.getString('label', true);
    const address = i.options.getString('address')?.trim();
    if (address) {
      if (!/^[A-HJ-NP-Za-km-z1-9]{25,100}$|^ltc1[0-9a-z]{25,100}$/.test(address))
        return i.reply({ content: 'LTC アドレスの形式が不正です', flags: MessageFlags.Ephemeral });
      const id = wallets.addLtcWallet(i.user.id, label, address);
      return i.reply({ content: `✅ LTC ウォレット (view-only) 追加 id=${id}`, flags: MessageFlags.Ephemeral });
    }
    // address 省略: BlockCypher でホットウォレット生成
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const { generateLtcHotAddress } = await import('./payments/ltc.js');
      const g = await generateLtcHotAddress();
      const derivation = JSON.stringify({ priv: g.priv, pub: g.pub });
      const id = wallets.addLtcWallet(i.user.id, label, g.address, derivation);
      const embed = new EmbedBuilder()
        .setTitle(`✅ LTC HOT ウォレット生成 id=${id}`)
        .setColor(0x22c55e)
        .setDescription('**自動出金対応**。このアドレスに運営資金を送って hot wallet 残高を作ってください。')
        .addFields(
          { name: 'Address', value: `\`${g.address}\`` },
          { name: '⚠️ 注意', value: '秘密鍵が DB に平文保存されています。大金の保管は非推奨、必要分だけ送金してください。' },
        );
      return i.editReply({ embeds: [embed] });
    } catch (e: any) {
      return i.editReply(`❌ ${e.message}`);
    }
  }
  if (sub === 'list') {
    const rows = wallets.listWallets();
    if (!rows.length) return i.reply({ content: 'ウォレット未登録', flags: MessageFlags.Ephemeral });
    const embed = new EmbedBuilder().setTitle('🏦 Wallets').setColor(0xd4af37)
      .setDescription(rows.map(w => {
        const head = `**#${w.id}** [${w.kind}] ${w.enabled?'🟢':'⚪'} \`${w.label}\``;
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
    if (!w || w.kind !== 'paypay') return i.reply({ content: 'PayPay ウォレットが見つかりません', flags: MessageFlags.Ephemeral });
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const bal = await wallets.withPaypay(w, t => pp.walletBalance(t));
    wallets.touchUsed(id, bal.usable_balance);
    return i.editReply(`💰 #${id} \`${w.label}\` — usable: **¥${bal.usable_balance.toLocaleString()}** / all: ¥${bal.all_balance.toLocaleString()} / pt: ${bal.points}`);
  }
}

function maskPhone(p: string | null): string {
  if (!p) return '-';
  const d = p.replace(/\D/g, '');
  if (d.length < 4) return '****';
  return `****${d.slice(-4)}`;
}

/* ────────────── ADMIN ────────────── */

async function cmdAdmin(i: ChatInputCommandInteraction) {
  const sub = i.options.getSubcommand();
  if (sub === 'balance') {
    const u = i.options.getUser('user', true);
    const delta = i.options.getInteger('delta', true);
    const reason = i.options.getString('reason') ?? 'admin-adjust';
    try {
      ensureUser(u.id);
      txCredit(u.id, delta, `admin:${reason}`, i.user.id);
      const bal = getBalance(u.id);
      return i.reply({ content: `✅ <@${u.id}> ${delta>=0?'+':''}${delta} → 残高 ${bal.toLocaleString()}`, flags: MessageFlags.Ephemeral });
    } catch (e: any) {
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
    const users = (db.prepare('SELECT COUNT(*) c FROM users').get() as any).c;
    const chips = (db.prepare('SELECT COALESCE(SUM(balance),0) s FROM users').get() as any).s;
    const bets  = (db.prepare("SELECT COALESCE(SUM(-delta),0) s FROM ledger WHERE reason LIKE 'bet:%'").get() as any).s;
    const wins  = (db.prepare("SELECT COALESCE(SUM(delta),0) s FROM ledger WHERE reason LIKE 'win:%'").get() as any).s;
    const deps  = (db.prepare("SELECT COALESCE(SUM(amount_jpy),0) s FROM deposits WHERE status='confirmed'").get() as any).s;
    const walletsCount = (db.prepare('SELECT COUNT(*) c FROM wallets WHERE enabled=1').get() as any).c;
    const m = await maxAffordableBet();
    const embed = new EmbedBuilder().setTitle('📊 C4sino Stats').setColor(0xd4af37)
      .addFields(
        { name: 'ユーザー数', value: `${users}`, inline: true },
        { name: '流通チップ', value: `${chips.toLocaleString()}`, inline: true },
        { name: '有効ウォレット', value: `${walletsCount}`, inline: true },
        { name: '累計 BET', value: `${bets.toLocaleString()}`, inline: true },
        { name: '累計 WIN', value: `${wins.toLocaleString()}`, inline: true },
        { name: 'ハウスエッジ', value: `${(bets-wins).toLocaleString()}`, inline: true },
        { name: '入金合計 (JPY換算)', value: `¥${deps.toLocaleString()}`, inline: false },
        { name: '🏦 ウォレット流動性',
          value: `PayPay: ¥${m.liq.paypay.toLocaleString()}\nLTC: ¥${m.liq.ltc.toLocaleString()}\n` +
                 `合計: ¥${m.liq.total.toLocaleString()}\n債務 (流通チップ): -¥${m.outstanding.toLocaleString()}\n` +
                 `**実効流動性: ¥${m.effective.toLocaleString()}**`,
          inline: false },
        { name: '📐 許容 BET 上限',
          value:
            `Blackjack:   **${m.blackjack.toLocaleString()}**\n` +
            `Slots:       **${m.slots.toLocaleString()}**\n` +
            `Roulette:    **${m.roulette.toLocaleString()}**\n` +
            `Baccarat:    **${m.baccarat.toLocaleString()}**\n` +
            `Video Poker: **${m.videopoker.toLocaleString()}**\n` +
            `Craps:       **${m.craps.toLocaleString()}**`,
          inline: false },
      );
    return i.editReply({ embeds: [embed] });
  }
  if (sub === 'tx') {
    const u = i.options.getUser('user', true);
    const limit = i.options.getInteger('limit') ?? 10;
    const rows = db.prepare('SELECT delta, reason, ref, created_at FROM ledger WHERE discord_id=? ORDER BY id DESC LIMIT ?')
      .all(u.id, Math.max(1, Math.min(50, limit))) as Array<{delta:number;reason:string;ref:string|null;created_at:number}>;
    if (!rows.length) return i.reply({ content: '取引なし', flags: MessageFlags.Ephemeral });
    const bal = getBalance(u.id);
    const list = rows.map(r => {
      const d = new Date(r.created_at*1000).toISOString().replace('T',' ').slice(0,16);
      return `\`${d}\` ${r.delta>=0?'+':''}${r.delta} — ${r.reason}${r.ref?` (${r.ref})`:''}`;
    }).join('\n');
    const embed = new EmbedBuilder().setTitle(`📜 <@${u.id}> のTX`).setDescription(list).setFooter({ text: `現残高 ${bal.toLocaleString()}` });
    return i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
  if (sub === 'user') {
    const u = i.options.getUser('user', true);
    ensureUser(u.id);
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const r = getReserves(u.id);

    const bets = (db.prepare(`SELECT COALESCE(SUM(-delta),0) s FROM ledger WHERE discord_id=? AND reason LIKE 'bet:%'`).get(u.id) as any).s as number;
    const wins = (db.prepare(`SELECT COALESCE(SUM(delta),0)  s FROM ledger WHERE discord_id=? AND reason LIKE 'win:%'`).get(u.id) as any).s as number;
    const depConfirmed = db.prepare(`SELECT method, COALESCE(SUM(amount_jpy),0) s FROM deposits WHERE discord_id=? AND status='confirmed' GROUP BY method`).all(u.id) as Array<{method:string;s:number}>;
    const wdSent = db.prepare(`SELECT method, COALESCE(SUM(amount_jpy),0) s FROM withdrawals WHERE discord_id=? AND status='sent' GROUP BY method`).all(u.id) as Array<{method:string;s:number}>;
    const ban = db.prepare('SELECT reason, banned_at FROM user_bans WHERE discord_id=?').get(u.id) as { reason:string; banned_at:number } | undefined;

    const lastTx = db.prepare(`SELECT delta, reason, ref, created_at FROM ledger WHERE discord_id=? ORDER BY id DESC LIMIT 5`).all(u.id) as Array<{delta:number;reason:string;ref:string|null;created_at:number}>;
    const openWd = db.prepare(`SELECT id, method, amount_jpy, status, created_at FROM withdrawals WHERE discord_id=? AND status IN ('pending','sent') ORDER BY created_at DESC LIMIT 5`).all(u.id) as any[];
    const activeSessions = sessions.listByUser(u.id);

    const sum = (rows: Array<{method:string;s:number}>, m: string) => rows.find(x => x.method === m)?.s ?? 0;
    const payload = await balanceReply(r.pp, r.ltc);

    const embed = new EmbedBuilder()
      .setTitle(`ユーザー総合ビュー`)
      .setColor(ban ? 0xef4444 : 0xd4af37)
      .setDescription(`<@${u.id}>  (\`${u.id}\`)` + (ban ? `\n🚫 **BAN**: ${ban.reason || '(理由なし)'} <t:${ban.banned_at}:R>` : ''))
      .addFields(
        { name: '累計 BET', value: `¥${bets.toLocaleString()}`, inline: true },
        { name: '累計 WIN', value: `¥${wins.toLocaleString()}`, inline: true },
        { name: 'ハウス収支', value: `${(bets-wins)>=0?'+':''}¥${(bets-wins).toLocaleString()}`, inline: true },
        { name: '入金合計', value:
          `PayPay: ¥${sum(depConfirmed,'paypay').toLocaleString()}\n` +
          `LTC:    ¥${sum(depConfirmed,'ltc').toLocaleString()}`, inline: true },
        { name: '出金合計 (sent)', value:
          `PayPay: ¥${sum(wdSent,'paypay').toLocaleString()}\n` +
          `LTC:    ¥${sum(wdSent,'ltc').toLocaleString()}`, inline: true },
        { name: '稼働セッション', value: activeSessions.length
          ? activeSessions.map(s => `${s.game} / bet ${s.bet.toLocaleString()}${s.mix?` (PP${s.mix.pp.toLocaleString()}+LTC${s.mix.ltc.toLocaleString()})`:''} / sid \`${s.id.slice(0,8)}\``).join('\n')
          : '_(なし)_', inline: false },
        { name: '直近出金', value: openWd.length
          ? openWd.map(w => `#${w.id} ${w.status==='pending'?'🟡':'🟢'} ${w.method} ¥${w.amount_jpy.toLocaleString()} <t:${w.created_at}:R>`).join('\n')
          : '_(なし)_', inline: false },
        { name: '直近取引 (ledger)', value: lastTx.length
          ? lastTx.map(t => `\`<t:${t.created_at}:t>\` ${t.delta>=0?'+':''}${t.delta.toLocaleString()} — ${t.reason}${t.ref?` (${t.ref})`:''}`).join('\n')
          : '_(なし)_', inline: false },
      )
      .setFooter({ text: '/admin grant で chip 付与 · /admin ban / unban で制裁' });

    return i.editReply({ embeds: [...payload.embeds, embed], files: payload.files });
  }

  if (sub === 'pending') {
    const methodFilter = i.options.getString('method') as 'paypay'|'ltc'|null;
    const limit = Math.min(25, Math.max(1, i.options.getInteger('limit') ?? 10));
    const where = methodFilter
      ? `WHERE status IN ('pending','sent','failed') AND method=?`
      : `WHERE status IN ('pending','sent','failed')`;
    const rows = db.prepare(`SELECT * FROM withdrawals ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...(methodFilter ? [methodFilter, limit] : [limit])) as any[];
    if (!rows.length) return i.reply({ content: '該当する出金はありません', flags: MessageFlags.Ephemeral });

    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const lines: string[] = [];
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
    const firstPendingLtc = rows.find(w => w.status === 'pending' && w.method === 'ltc') as any;
    const components: ActionRowBuilder<ButtonBuilder>[] = [];
    if (firstPendingLtc) {
      components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`wd:approve:${firstPendingLtc.id}`).setLabel(`LTC #${firstPendingLtc.id} 承認`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`wd:reject:${firstPendingLtc.id}`).setLabel(`LTC #${firstPendingLtc.id} 却下 (返金)`).setStyle(ButtonStyle.Danger),
      ));
    }
    return i.editReply({ embeds: [embed], components });
  }

  if (sub === 'grant') {
    const u = i.options.getUser('user', true);
    const rail = i.options.getString('rail', true) as 'pp'|'ltc';
    const amount = i.options.getInteger('amount', true);
    const reason = i.options.getString('reason') ?? 'admin-grant';
    ensureUser(u.id);
    try {
      if (amount > 0) {
        creditRail(u.id, rail, amount, `grant:${rail}:${reason}`, i.user.id);
      } else if (amount < 0) {
        const { debitRail } = await import('./db/schema.js');
        debitRail(u.id, rail, -amount, `revoke:${rail}:${reason}`, i.user.id);
      } else return i.reply({ content: '金額が 0 です', flags: MessageFlags.Ephemeral });
    } catch (e: any) {
      return i.reply({ content: `❌ ${e.message}`, flags: MessageFlags.Ephemeral });
    }
    const r = getReserves(u.id);
    return i.reply({
      content: `✅ <@${u.id}> に ${rail.toUpperCase()} 由来 ${amount>=0?'+':''}¥${amount.toLocaleString()} を適用\n` +
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
    if (bad) return i.editReply(`❌ 送金拒否: ${bad}`);
    const candidates = wallets.listWallets('paypay')
      .filter(x => x.enabled && x.access_token && (x.balance_cached ?? 0) >= amount)
      .sort((a, b) => (b.balance_cached ?? 0) - (a.balance_cached ?? 0));
    const w = candidates[0];
    if (!w) return i.editReply(`❌ ¥${amount.toLocaleString()} を送れる PayPay ウォレットがありません`);
    const opRow = db.prepare(`INSERT INTO operator_payouts(admin_id, wallet_id, amount_jpy, passcode, status, reason)
      VALUES (?, ?, ?, ?, 'pending', ?)`).run(i.user.id, w.id, amount, passcode ?? null, `send-paypay:to:${u.id}:${reason}`);
    const opId = opRow.lastInsertRowid as number;
    let link;
    try {
      link = await wallets.withPaypay(w, t => pp.createLink(t, amount, passcode));
    } catch (e: any) {
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
        .addFields(
          { name: 'Link', value: link.link },
          ...(passcode ? [{ name: 'Passcode', value: `\`${passcode}\``, inline: true }] : []),
          { name: 'Reason', value: reason, inline: true },
        )
        .setFooter({ text: `Operator payout #${opId}` });
      await target.send({ embeds: [embed] });
    } catch (e) {
      console.warn('[admin send-paypay] DM failed:', (e as Error).message);
    }

    return i.editReply(`✅ <@${u.id}> に PayPay ¥${amount.toLocaleString()} を送金 (opId #${opId}, wallet #${w.id})`);
  }

  if (sub === 'send-ltc') {
    const u = i.options.getUser('user', true);
    const dest = i.options.getString('dest', true).trim();
    const ltcAmount = i.options.getNumber('ltc', true);
    const reason = i.options.getString('reason') ?? 'admin-send';
    if (!/^[A-HJ-NP-Za-km-z1-9]{25,100}$|^ltc1[0-9a-z]{25,100}$/.test(dest))
      return i.reply({ content: '❌ LTC アドレスの形式が不正', flags: MessageFlags.Ephemeral });
    await i.deferReply({ flags: MessageFlags.Ephemeral });

    const rate = await (await import('./payments/ltc.js')).ltcJpyRate();
    const jpy = Math.floor(ltcAmount * rate);
    const bad = await assertOperatorWithdrawSafe(jpy, 'ltc');
    if (bad) return i.editReply(`❌ 送金拒否: ${bad}`);

    const { sendLtc } = await import('./payments/ltc.js');
    const hots = wallets.listLtcHotWallets();
    let lastErr = 'HOT ウォレットが見つかりません';
    for (const w of hots) {
      try {
        const sent = await sendLtc(w.address!, w.key.priv, dest, ltcAmount);
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
            .addFields(
              { name: 'To', value: `\`${dest}\`` },
              { name: 'Amount', value: `${ltcAmount} LTC (≈ ¥${jpy.toLocaleString()})`, inline: true },
              { name: 'Reason', value: reason, inline: true },
              { name: 'txid', value: `\`${sent.txid}\`` },
            )
            .setFooter({ text: `Operator payout #${opRow.lastInsertRowid}` });
          await target.send({ embeds: [embed] });
        } catch { /* DM 失敗は致命でない */ }
        return i.editReply(`✅ <@${u.id}> に ${ltcAmount} LTC (≈ ¥${jpy.toLocaleString()}) 送金完了\ntxid: \`${sent.txid}\``);
      } catch (e: any) {
        lastErr = e.message;
      }
    }
    return i.editReply(`❌ LTC 送金失敗: ${lastErr}`);
  }

  if (sub === 'automod-sync') {
    if (!i.guild) return i.reply({ content: 'ギルド内で実行してください', flags: MessageFlags.Ephemeral });
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const removed = await removeGuildAutoMod(i.guild);
      return i.editReply(
        removed
          ? `✅ 旧 AutoMod rule \`${AUTOMOD_RULE_NAME}\` を削除しました。NG 語は Webhook 書き換え方式で処理されます。`
          : `ℹ️ 削除対象なし (すでに Webhook 書き換え方式のみ有効)`
      );
    } catch (e: any) {
      return i.editReply(`❌ AutoMod cleanup 失敗: ${e.message}`);
    }
  }
  if (sub === 'achievements') {
    const ch = i.options.getChannel('channel');
    if (!ch) {
      ach.setConfig(i.guildId!, null, null);
      return i.reply({ content: '✅ 実績チャンネルを解除しました', flags: MessageFlags.Ephemeral });
    }
    const base = i.options.getString('base') ?? (ch.name ?? 'achievements').replace(/[-_ー]実績\d+件$/, '');
    ach.setConfig(i.guildId!, ch.id, base);
    const count = ach.countAchievements(i.guildId!);
    // 即リネームを試みる
    try {
      const fetched = await client.channels.fetch(ch.id);
      if (fetched && 'setName' in fetched) await (fetched as any).setName(ach.formatChannelName(base, count));
    } catch (e) { /* rate limit など */ }
    return i.reply({
      content: `✅ 実績チャンネル: <#${ch.id}>\nベース名: \`${base}\`  /  現在 ${count} 件`,
      flags: MessageFlags.Ephemeral
    });
  }
  if (sub === 'panel') {
    if (!i.channel || !('send' in i.channel)) return i.reply({ content: 'このチャンネルには設置できません', flags: MessageFlags.Ephemeral });
    const embed = new EmbedBuilder().setTitle('🛠️  Admin Panel').setColor(0xd4af37)
      .setDescription('カジノ運営の各種ショートカット');
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('adm:stats').setLabel('統計').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('adm:wallets').setLabel('ウォレット一覧').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('adm:pending').setLabel('最近の入金').setStyle(ButtonStyle.Secondary),
    );
    await i.channel.send({ embeds: [embed], components: [row] });
    return i.reply({ content: '✅ 管理パネル設置', flags: MessageFlags.Ephemeral });
  }
}

/* ────────────── BUTTONS ────────────── */

async function onButton(i: ButtonInteraction) {
  const [ns, kind, arg] = i.customId.split(':');
  if (ns === 'play') return onPlayButton(i);          // play:<game>[:<subarg>]
  if (ns === 'leet' && kind === 'convert') return onLeetButton(i);
  if (ns === 'bj') return onBJButton(i, kind, arg);
  if (ns === 'slot') return onSlotButton(i, kind, arg);
  if (ns === 'rou')  return onRouletteButton(i, kind, arg);
  if (ns === 'bac')  return onBaccaratButton(i, kind, arg);
  if (ns === 'vp')   return onVpButton(i, kind, arg);
  if (ns === 'cr')   return onCrapsButton(i, kind, arg);
  if (ns === 'dep') return onDepositButton(i, kind, arg);
  if (ns === 'adm') return onAdminButton(i, kind);
  if (ns === 'wd' && (kind === 'approve' || kind === 'reject')) return onWithdrawAdmin(i, kind, arg);
  if (ns === 'bal') {
    const r = getReserves(i.user.id);
    const payload = await balanceReply(r.pp, r.ltc);
    return i.reply({ ...payload, flags: MessageFlags.Ephemeral });
  }
}

async function onWithdrawAdmin(i: ButtonInteraction, kind: string, arg: string) {
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
    return i.reply({ content: '権限不足', flags: MessageFlags.Ephemeral });
  const id = parseInt(arg, 10);
  if (kind === 'approve') {
    const modal = new ModalBuilder().setCustomId(`wd:approve:${id}`).setTitle(`LTC 出金 #${id} — Mark Sent`)
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('txid').setLabel('LTC Transaction ID (txid)').setStyle(TextInputStyle.Short).setRequired(true)
      ));
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
      await user?.send(`❌ LTC 出金 #${id} は却下されました。chip を返金しました。`).catch(()=>{});
    } catch (e: any) {
      await i.reply({ content: `❌ ${e.message}`, flags: MessageFlags.Ephemeral });
    }
  }
}

async function onAdminButton(i: ButtonInteraction, kind: string) {
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
    return i.reply({ content: '権限不足', flags: MessageFlags.Ephemeral });
  if (kind === 'stats') {
    // reuse command logic
    const fake = { ...i, options: { getSubcommand: () => 'stats' } } as any;
    return cmdAdmin(fake);
  }
  if (kind === 'wallets') {
    const fake = { ...i, options: { getSubcommand: () => 'list' } } as any;
    return cmdWallet(fake);
  }
  if (kind === 'pending') {
    const rows = db.prepare(`SELECT id, discord_id, method, amount_jpy, status, created_at FROM deposits
      ORDER BY id DESC LIMIT 15`).all() as Array<any>;
    const txt = rows.map(r => {
      const d = new Date(r.created_at*1000).toISOString().slice(0,16).replace('T',' ');
      return `\`${d}\` #${r.id} [${r.method}] <@${r.discord_id}> ¥${r.amount_jpy.toLocaleString()} — **${r.status}**`;
    }).join('\n') || '履歴なし';
    const embed = new EmbedBuilder().setTitle('🧾 最近の入金').setDescription(txt).setColor(0xd4af37);
    return i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}

/* ────────────── BLACKJACK ────────────── */

async function onBJButton(i: ButtonInteraction, kind: string, arg: string) {
  if (kind === 'bet') {
    assertNotBanned(i.user.id);
    if (arg === 'custom') {
      const modal = new ModalBuilder().setCustomId('bj:custombet').setTitle(`${L('BLACKJACK')} — ${L('Custom')} ${L('Bet')}`)
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('amt').setLabel(`${L('BET')} (${L('chips')})`).setStyle(TextInputStyle.Short).setRequired(true)
        ));
      return i.showModal(modal);
    }
    return startBJ(i, parseInt(arg, 10));
  }
  if (kind === 'act') {
    const sid = extractSid(i.message.embeds[0]?.footer?.text);
    if (!sid) return i.reply({ content: 'セッションが見つかりません', flags: MessageFlags.Ephemeral });
    const entry = sessions.get(sid);
    if (!entry || entry.discordId !== i.user.id) return i.reply({ content: 'このセッションは他のユーザーのものです', flags: MessageFlags.Ephemeral });
    const st = entry.state as BJState;
    const cap = await housePayoutCap();
    apply(st, arg as 'hit'|'stand'|'double'|'split', cap);
    await updateBJMessage(i, entry.id, st);
  }
}

function extractSid(footer?: string | null): string | null {
  if (!footer) return null;
  const m = footer.match(/sid=([0-9a-f-]+)/);
  return m?.[1] ?? null;
}

async function startBJ(i: ButtonInteraction | ModalSubmitInteraction, bet: number, mix?: BetMix) {
  assertNotBanned(i.user.id);
  ensureUser(i.user.id);
  if (bet < 10 || bet > 50000) return i.reply({ content: `${L('BET')} は 10 〜 50,000`, flags: MessageFlags.Ephemeral });
  if (getBalance(i.user.id) < bet) return i.reply({ content: '残高不足', flags: MessageFlags.Ephemeral });
  if (mix) applyMix(i.user.id, -mix.pp, -mix.ltc, 'bet:blackjack');
  else txCredit(i.user.id, -bet, 'bet:blackjack');
  const st = startHand(bet, newShoe());
  const entry = sessions.create(i.user.id, 'blackjack', st, bet, mix);

  if (isBlackjack(st.player[0]) || isBlackjack(st.dealer)) {
    const dealerBJ = isBlackjack(st.dealer);
    const playerBJ = isBlackjack(st.player[0]);
    if (playerBJ && dealerBJ) { st.results = ['push']; st.payout = bet; }
    else if (playerBJ) { st.results = ['bj']; st.payout = Math.floor(bet * 2.5); }
    else { st.results = ['lose']; st.payout = 0; }
    st.phase = 'done';
  }

  await sendBJEphemeral(i as ButtonInteraction, entry.id, st);
}

async function sendBJEphemeral(i: ButtonInteraction, sid: string, st: BJState) {
  if (st.phase === 'done') await applyBJClamp(st);
  const buf = await renderBlackjack({
    player: st.player, active: st.active, dealer: st.dealer,
    hideHole: st.phase === 'player',
    bets: st.bets, balance: getBalance(i.user.id),
    phase: st.phase, results: st.results, payout: st.payout,
  });
  const file = new AttachmentBuilder(buf, { name: 'bj.png' });
  const embed = buildBJEmbed(st, getBalance(i.user.id), sid);
  embed.setImage('attachment://bj.png');
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  if (st.phase === 'player') rows.push(bjActionsRow(availableActions(st)));

  await (i as any).reply({ embeds: [embed], files: [file], components: rows, flags: MessageFlags.Ephemeral });

  if (st.phase === 'done') {
    if (st.payout && st.payout > 0) {
      const mix = sessions.get(sid)?.mix;
      if (mix) payoutByMix(i.user.id, st.payout, mix, 'win:blackjack', sid);
      else txCredit(i.user.id, st.payout, 'win:blackjack', sid);
    }
    await onGameSettled(i, 'blackjack', st);
    sessions.drop(sid);
  }
}

function buildBJEmbed(st: BJState, balance: number, sid: string): EmbedBuilder {
  const totalBet = st.bets.reduce((a,b)=>a+b, 0);
  const dTotal = handTotal(st.dealer).total;
  const pTotals = st.player.map(h => handTotal(h).total);

  let title = `🂡 ${L('BLACKJACK')}`;
  let color = 0x3b82f6;        // 青: 進行中
  let header = '';

  if (st.phase === 'player') {
    header = `あなたの番 — hand ${st.active + 1}/${st.player.length}`;
  } else if (st.phase === 'dealer') {
    header = 'ディーラーの引き…';
  } else {
    // done
    const net = (st.payout ?? 0) - totalBet;
    if (net > 0) {
      header = `**${L('YOU')} ${L('WIN')}!**  +${net.toLocaleString()} ${L('chips')}`;
      color = 0x22c55e;
    } else if (net < 0) {
      header = `**${L('LOSE')}**  ${net.toLocaleString()} ${L('chips')}`;
      color = 0xef4444;
    } else {
      header = `**${L('PUSH')}**  — bet 返却`;
      color = 0x9ca3af;
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(header)
    .setColor(color)
    .addFields(
      { name: L('Dealer'), value: st.phase === 'player' ? `**?** + ${handTotal([st.dealer[0]]).total}` : `**${dTotal}**`, inline: true },
      { name: L('Player'), value: pTotals.map(t => `**${t}**`).join(' / '), inline: true },
      { name: L('Bet'),    value: `${totalBet.toLocaleString()} ${L('chips')}`, inline: true },
      { name: L('Balance'), value: `${balance.toLocaleString()} ${L('chips')}`, inline: true },
    )
    .setFooter({ text: `sid=${sid}` });
  return embed;
}

/** 払戻しを cap まで clamp し、payout=0 になるハンドの結果は 'lose' に書換 */
async function applyBJClamp(st: BJState) {
  if (!st.payout) return;
  const cap = await housePayoutCap();
  if (st.payout <= cap) return;
  // payout を cap に clamp。表示整合のため: 全ハンドをプロラタで減らすのではなく、
  // 最も payout の大きい win ハンドから順に 'lose' に書き換えて cap 以下にする
  if (!st.results) return;
  const idxByPay = st.player
    .map((_, idx) => ({ idx, hand: idx }))
    .sort((a, b) => (payoutForHand(st, b.idx) - payoutForHand(st, a.idx)));
  for (const { idx } of idxByPay) {
    if (st.payout! <= cap) break;
    const was = payoutForHand(st, idx);
    if (was > 0 && st.results[idx] !== 'lose') {
      st.results[idx] = 'lose';
      st.payout = (st.payout ?? 0) - was;
    }
  }
  st.payout = Math.max(0, Math.min(st.payout!, cap));
}
function payoutForHand(st: BJState, idx: number): number {
  const r = st.results?.[idx]; const bet = st.bets[idx];
  if (r === 'bj')   return Math.floor(bet * 2.5);
  if (r === 'win')  return bet * 2;
  if (r === 'push') return bet;
  return 0;
}

async function onGameSettled(i: ButtonInteraction | ModalSubmitInteraction, game: 'blackjack'|'slots'|'roulette'|'baccarat'|'videopoker'|'craps', st: BJState | null, extBet?: number, extPayout?: number) {
  if (!i.guildId) return;
  let bet = 0, payout = 0;
  if (game === 'blackjack' && st) {
    bet = st.bets.reduce((a,b)=>a+b, 0);
    payout = st.payout ?? 0;
  } else {
    bet = extBet ?? 0;
    payout = extPayout ?? 0;
  }
  const net = payout - bet;
  if (net <= 0) return;
  ach.recordAchievement({
    guildId: i.guildId, discordId: i.user.id, game: game as any, bet, payout, net,
  });
  await ach.announce(client, {
    guildId: i.guildId, discordId: i.user.id, game: game as any, bet, payout, net,
  });
}

async function updateBJMessage(i: ButtonInteraction, sid: string, st: BJState) {
  if (st.phase === 'done') await applyBJClamp(st);
  const buf = await renderBlackjack({
    player: st.player, active: st.active, dealer: st.dealer,
    hideHole: st.phase === 'player',
    bets: st.bets, balance: getBalance(i.user.id),
    phase: st.phase, results: st.results, payout: st.payout,
  });
  const file = new AttachmentBuilder(buf, { name: 'bj.png' });
  const embed = buildBJEmbed(st, getBalance(i.user.id), sid);
  embed.setImage('attachment://bj.png');
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  if (st.phase === 'player') rows.push(bjActionsRow(availableActions(st)));
  await i.update({ embeds: [embed], files: [file], components: rows, attachments: [] });
  if (st.phase === 'done') {
    if (st.payout && st.payout > 0) {
      const mix = sessions.get(sid)?.mix;
      if (mix) payoutByMix(i.user.id, st.payout, mix, 'win:blackjack', sid);
      else txCredit(i.user.id, st.payout, 'win:blackjack', sid);
    }
    await onGameSettled(i, 'blackjack', st);
    sessions.drop(sid);
  }
}

/* ────────────── SLOTS ────────────── */

async function onSlotButton(i: ButtonInteraction, kind: string, arg: string) {
  if (kind !== 'spin') return;
  assertNotBanned(i.user.id);
  if (arg === 'custom') {
    const modal = new ModalBuilder().setCustomId('slot:custombet').setTitle(`${L('SLOTS')} — ${L('Custom')} ${L('Bet')}`)
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('amt').setLabel(`${L('BET')} (${L('chips')})`).setStyle(TextInputStyle.Short).setRequired(true)
      ));
    return i.showModal(modal);
  }
  await doSpin(i, parseInt(arg, 10));
}

async function doSpin(i: ButtonInteraction | ModalSubmitInteraction, bet: number, mix?: BetMix) {
  assertNotBanned(i.user.id);
  ensureUser(i.user.id);
  if (bet < 10 || bet > 10000) return i.reply({ content: `${L('BET')} は 10 〜 10,000`, flags: MessageFlags.Ephemeral });
  if (getBalance(i.user.id) < bet) return i.reply({ content: '残高不足', flags: MessageFlags.Ephemeral });
  if (mix) applyMix(i.user.id, -mix.pp, -mix.ltc, 'bet:slots');
  else txCredit(i.user.id, -bet, 'bet:slots');

  const result = spinWithCap(bet, await housePayoutCap());
  const stripA = reelStrip(result.reels[0], 8);
  const stripB = reelStrip(result.reels[1], 10);
  const stripC = reelStrip(result.reels[2], 12);

  const first = await renderSlots({
    reels: [stripA[0], stripB[0], stripC[0]],
    above: [stripA[1] ?? stripA[0], stripB[1] ?? stripB[0], stripC[1] ?? stripC[0]],
    below: [stripA[2] ?? stripA[0], stripB[2] ?? stripB[0], stripC[2] ?? stripC[0]],
    bet, balance: getBalance(i.user.id), payoutMult: 0, spinning: true,
  });
  await i.reply({ files: [new AttachmentBuilder(first, { name: 's.png' })], flags: MessageFlags.Ephemeral });

  const frames: [number, number, number][] = [
    [3, 5, 7],
    [stripA.length - 1, 7, 9],
    [stripA.length - 1, stripB.length - 1, stripC.length - 1],
  ];
  for (let f = 0; f < frames.length; f++) {
    await new Promise(r => setTimeout(r, 650));
    const [ia, ib, ic] = frames[f];
    const spinning = f < frames.length - 1;
    const buf = await renderSlots({
      reels:  [stripA[ia], stripB[ib], stripC[ic]],
      above:  [stripA[Math.max(0,ia-1)], stripB[Math.max(0,ib-1)], stripC[Math.max(0,ic-1)]],
      below:  [stripA[Math.min(stripA.length-1,ia+1)], stripB[Math.min(stripB.length-1,ib+1)], stripC[Math.min(stripC.length-1,ic+1)]],
      bet, balance: getBalance(i.user.id),
      payoutMult: spinning ? 0 : result.payoutMult,
      spinning,
      label: !spinning && result.payoutMult >= 200 ? (result.payoutMult >= 2000 ? L('JACKPOT') : `${L('BIG')} ${L('WIN')}`) : L('WIN'),
    });
    await i.editReply({ files: [new AttachmentBuilder(buf, { name: 's.png' })] });
  }

  if (result.payoutMult > 0) {
    const win = await clampPayout(bet * result.payoutMult);
    if (win > 0) {
      if (mix) payoutByMix(i.user.id, win, mix, 'win:slots');
      else txCredit(i.user.id, win, 'win:slots');
    }
    await onGameSettled(i, 'slots', null, bet, win);
  }
}

/* ────────────── ROULETTE ────────────── */

const ROU_LABEL: Record<string, string> = {
  red: '🟥 Red', black: '⬛ Black', odd: 'Odd', even: 'Even',
  low: '1–18 Low', high: '19–36 High',
  dozen1: 'Dozen 1–12', dozen2: 'Dozen 13–24', dozen3: 'Dozen 25–36',
  column1: 'Column 1', column2: 'Column 2', column3: 'Column 3',
  number: 'Single Number',
};

async function onRouletteButton(i: ButtonInteraction, kind: string, arg: string) {
  assertNotBanned(i.user.id);
  if (kind === 'start') {
    // パネル押下 → ベット種類選択画面を ephemeral で表示
    const embed = new EmbedBuilder()
      .setTitle(`🎡 ${L('ROULETTE')} — ベット選択`)
      .setDescription('どの掛け方にするか選んでください。')
      .setColor(0x0d5a3a);
    return i.reply({ embeds: [embed], components: [rouletteBetSelectRow()], flags: MessageFlags.Ephemeral });
  }
  // 後方互換: 旧ボタン(rou:bet:...) が残っているパネルからの呼び出し
  if (kind !== 'bet') return;
  return openRouletteAmountModal(i, arg);
}

async function openRouletteAmountModal(i: ButtonInteraction | StringSelectMenuInteraction, kind: string) {
  if (kind === 'number') {
    const modal = new ModalBuilder().setCustomId('rou:num').setTitle(`${L('ROULETTE')} — Single Number`)
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('num').setLabel('数字 (0〜36)').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('amt').setLabel(`${L('BET')} (${L('chips')})`).setStyle(TextInputStyle.Short).setRequired(true)),
      );
    return i.showModal(modal);
  }
  const modal = new ModalBuilder().setCustomId(`rou:amt:${kind}`).setTitle(`${L('ROULETTE')} — ${ROU_LABEL[kind] ?? kind}`)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId('amt').setLabel(`${L('BET')} (${L('chips')})`).setStyle(TextInputStyle.Short).setRequired(true)
    ));
  return i.showModal(modal);
}

async function doRouletteSpin(
  i: ModalSubmitInteraction,
  kind: RouKind, bet: number, number?: number, mix?: BetMix
) {
  assertNotBanned(i.user.id);
  ensureUser(i.user.id);
  if (bet < 10 || bet > 50_000) return i.reply({ content: `${L('BET')} は 10 〜 50,000`, flags: MessageFlags.Ephemeral });
  if (getBalance(i.user.id) < bet) return i.reply({ content: '残高不足', flags: MessageFlags.Ephemeral });
  if (kind === 'number' && (number === undefined || number < 0 || number > 36))
    return i.reply({ content: '数字は 0 〜 36 です', flags: MessageFlags.Ephemeral });
  if (mix) applyMix(i.user.id, -mix.pp, -mix.ltc, 'bet:roulette');
  else txCredit(i.user.id, -bet, 'bet:roulette');

  const result = spinRouletteWithCap({ kind, amount: bet, number }, await housePayoutCap());
  const mult   = rouPayout({ kind, amount: bet, number }, result);
  const label  = kind === 'number' ? `${ROU_LABEL.number} ${number}` : (ROU_LABEL[kind] ?? kind);

  // 回転アニメ (4フレーム: ホイール位置が徐々に結果に収束)
  const finalIdx = WHEEL.indexOf(result);
  const seg = (Math.PI * 2) / WHEEL.length;
  const finalAngle = finalIdx * seg;
  // 動き: 2回転+減衰して finalAngle に着地
  const frames = 4;
  const total  = Math.PI * 2 * 3 + finalAngle;    // 3回転 + 着地角
  const angles = Array.from({length: frames}, (_, k) => {
    const t = (k + 1) / frames;       // 0.25, 0.5, 0.75, 1.0
    const eased = 1 - Math.pow(1 - t, 3);  // ease-out cubic
    return eased * total;
  });

  const buildRouEmbed = (spinning: boolean, finalMult: number) => {
    const color = spinning ? 0x3b82f6 : finalMult > 0 ? 0x22c55e : 0xef4444;
    const e = new EmbedBuilder().setTitle(`🎡 ${L('ROULETTE')}`).setColor(color).setImage('attachment://r.png');
    if (spinning) {
      e.setDescription(`${L('SPINNING')}… bet: **${label}**`);
    } else {
      const col = result === 0 ? '🟩' : (result % 2 === 1 ? '🟥' : '⬛');
      const win = bet * finalMult;
      const net = win - bet;
      e.setDescription(finalMult > 0 ? `**${L('YOU')} ${L('WIN')}!** +${net.toLocaleString()} ${L('chips')}` : `**${L('LOSE')}** ${(-bet).toLocaleString()} ${L('chips')}`);
      e.addFields(
        { name: 'Result', value: `${col} **${result}**`, inline: true },
        { name: L('Bet'), value: `${label} ${bet.toLocaleString()}`, inline: true },
        { name: L('Balance'), value: `${getBalance(i.user.id).toLocaleString()}`, inline: true },
      );
    }
    return e;
  };

  const first = await renderRoulette({ resultNumber: result, ballAngle: 0, spinning: true });
  await i.reply({
    embeds: [buildRouEmbed(true, 0)],
    files: [new AttachmentBuilder(first, { name: 'r.png' })],
    flags: MessageFlags.Ephemeral,
  });
  for (let f = 0; f < frames; f++) {
    await new Promise(r => setTimeout(r, 700));
    const spinning = f < frames - 1;
    const buf = await renderRoulette({ resultNumber: result, ballAngle: angles[f], spinning });
    await i.editReply({
      embeds: [buildRouEmbed(spinning, mult)],
      files: [new AttachmentBuilder(buf, { name: 'r.png' })],
    });
  }

  if (mult > 0) {
    const win = await clampPayout(bet * mult);
    if (win > 0) {
      if (mix) payoutByMix(i.user.id, win, mix, 'win:roulette');
      else txCredit(i.user.id, win, 'win:roulette');
    }
    await onGameSettled(i, 'roulette', null, bet, win);
  }
}

/* ────────────── CRAPS ────────────── */

async function onCrapsButton(i: ButtonInteraction, kind: string, _arg: string) {
  assertNotBanned(i.user.id);
  if (kind === 'start') {
    ensureUser(i.user.id);
    const st = newCraps();
    const entry = sessions.create(i.user.id, 'craps', st, 0);
    setCrapsExposure(entry.id, 0);
    return sendCrapsEphemeral(i, entry.id, st);
  }

  // 以降は進行中セッション前提
  const sid = extractSid(i.message.embeds[0]?.footer?.text);
  if (!sid) return i.reply({ content: 'セッションが見つかりません', flags: MessageFlags.Ephemeral });
  const entry = sessions.get(sid);
  if (!entry || entry.discordId !== i.user.id) return i.reply({ content: '他ユーザーのセッションです', flags: MessageFlags.Ephemeral });
  const st = entry.state as CrapsState;

  if (kind === 'undo') {
    const last = st.bets.pop();
    if (last) {
      txCredit(i.user.id, last.amount, 'bet:craps:undo', sid);
      st.totalWagered -= last.amount;
      setCrapsExposure(sid, openExposure(st));
    }
    return updateCrapsMessage(i, sid, st);
  }

  if (kind === 'end') {
    clearCrapsExposure(sid);
    sessions.drop(sid);
    const final = await renderCraps({ state: st });
    const net = st.totalReturned - st.totalWagered;
    const embed = new EmbedBuilder()
      .setImage('attachment://craps-end.png')
      .setColor(net > 0 ? 0x22c55e : net < 0 ? 0xef4444 : 0x9ca3af)
      .setTitle(`🎲 ${L('CRAPS')} セッション終了`)
      .setDescription(`累計 ${net>=0?'+':''}${net.toLocaleString()} ${L('chips')} (賭 ${st.totalWagered.toLocaleString()} / 戻 ${st.totalReturned.toLocaleString()})`);
    return i.update({
      embeds: [embed],
      files: [new AttachmentBuilder(final, { name: 'craps-end.png' })],
      components: [], attachments: [],
    });
  }

  if (kind === 'roll') {
    if (st.bets.length === 0) return i.reply({ content: 'ベットがありません', flags: MessageFlags.Ephemeral });
    return doCrapsRoll(i, sid, st);
  }
}

function buildCrapsEmbed(sid: string, st: CrapsState, balance: number): EmbedBuilder {
  const net = st.totalReturned - st.totalWagered;
  const color = st.phase === 'comeout' ? 0x3b82f6 : 0xf59e0b;
  const header = st.phase === 'comeout'
    ? `**COME OUT** — 7/11 勝ち / 2/3/12 クラップス / 4-10 point 成立`
    : `**POINT ${st.point}** — ${st.point} 再出で Pass 勝ち / 7 で Seven-Out`;
  const betsText = st.bets.length
    ? st.bets.slice(-10).map(b => `\`#${b.id}\` ${b.kind}${b.point?`→${b.point}`:''} **${b.amount.toLocaleString()}**`).join('\n') + (st.bets.length>10?`\n…他${st.bets.length-10}件`:'')
    : '_ベットなし_';
  const histText = st.history.length ? st.history.slice(-5).join('\n') : '_まだ振られていません_';
  return new EmbedBuilder()
    .setTitle(`🎲 ${L('CRAPS')}`)
    .setColor(color)
    .setDescription(header)
    .addFields(
      { name: `アクティブなベット (${st.bets.length})`, value: betsText, inline: false },
      { name: '直近の振り', value: histText.length > 1000 ? histText.slice(-1000) : histText, inline: false },
      { name: L('Balance'), value: `${balance.toLocaleString()} ${L('chips')}`, inline: true },
      { name: '累計', value: `${net>=0?'+':''}${net.toLocaleString()} (賭 ${st.totalWagered.toLocaleString()} / 戻 ${st.totalReturned.toLocaleString()})`, inline: true },
    )
    .setFooter({ text: `sid=${sid}` });
}

async function sendCrapsEphemeral(i: ButtonInteraction, sid: string, st: CrapsState) {
  const buf = await renderCraps({ state: st });
  const file = new AttachmentBuilder(buf, { name: 'craps.png' });
  const embed = buildCrapsEmbed(sid, st, getBalance(i.user.id)).setImage('attachment://craps.png');
  const rows = crapsControlRows({ phase: st.phase, point: st.point, betCount: st.bets.length });
  await i.reply({ embeds: [embed], files: [file], components: rows, flags: MessageFlags.Ephemeral });
}

async function updateCrapsMessage(i: ButtonInteraction, sid: string, st: CrapsState) {
  const buf = await renderCraps({ state: st });
  const file = new AttachmentBuilder(buf, { name: 'craps.png' });
  const embed = buildCrapsEmbed(sid, st, getBalance(i.user.id)).setImage('attachment://craps.png');
  const rows = crapsControlRows({ phase: st.phase, point: st.point, betCount: st.bets.length });
  await i.update({ embeds: [embed], files: [file], components: rows, attachments: [] });
}

async function placeCrapsBet(i: ModalSubmitInteraction, sid: string, kind: CrapsBetKind, amount: number) {
  assertNotBanned(i.user.id);
  const entry = sessions.get(sid);
  if (!entry || entry.discordId !== i.user.id) return i.reply({ content: 'セッションが見つかりません', flags: MessageFlags.Ephemeral });
  const st = entry.state as CrapsState;

  if (!Number.isFinite(amount) || amount < 10 || amount > 50_000)
    return i.reply({ content: `${L('BET')} は 10 〜 50,000`, flags: MessageFlags.Ephemeral });

  // フェーズ制約
  if ((kind === 'pass_odds' || kind === 'dontpass_odds') && st.phase !== 'point')
    return i.reply({ content: `Odds はポイント確立後のみ`, flags: MessageFlags.Ephemeral });
  if ((kind === 'come' || kind === 'dontcome') && st.phase !== 'point')
    return i.reply({ content: `Come / Don't Come はポイント確立後のみ`, flags: MessageFlags.Ephemeral });
  if (kind === 'pass' && st.phase === 'point')
    return i.reply({ content: `Pass Line は come-out 時のみ (今は Come を使用)`, flags: MessageFlags.Ephemeral });
  if (kind === 'dontpass' && st.phase === 'point')
    return i.reply({ content: `Don't Pass は come-out 時のみ (今は Don't Come を使用)`, flags: MessageFlags.Ephemeral });

  if (getBalance(i.user.id) < amount)
    return i.reply({ content: '残高不足', flags: MessageFlags.Ephemeral });

  txCredit(i.user.id, -amount, `bet:craps:${kind}`, sid);
  addBet(st, kind, amount);
  setCrapsExposure(sid, openExposure(st));

  await i.deferUpdate().catch(()=>{});
  const buf = await renderCraps({ state: st });
  const file = new AttachmentBuilder(buf, { name: 'craps.png' });
  const embed = buildCrapsEmbed(sid, st, getBalance(i.user.id)).setImage('attachment://craps.png');
  const rows = crapsControlRows({ phase: st.phase, point: st.point, betCount: st.bets.length });
  await i.editReply({ embeds: [embed], files: [file], components: rows, attachments: [] });
}

async function doCrapsRoll(i: ButtonInteraction, sid: string, st: CrapsState) {
  const cap = await housePayoutCap(sid);
  const report = crapsRoll(st, cap);
  st.lastRoll = [report.d1, report.d2];
  let totalPayout = 0;
  const newBets: CrapsBet[] = [];
  for (const r of report.resolutions) {
    if (r.payout > 0) {
      totalPayout += r.payout;
    }
    if (r.stay) {
      if (r.pointMoved) r.bet.point = r.pointMoved;
      newBets.push(r.bet);
    }
    // 勝利/push で part-of payout が戻る場合、Place/Hardways のような stay=true は amount を温存 (payout は追加のみ) — win(mult-1) を使用済み
  }
  st.bets = newBets;

  // フェーズ遷移
  if (report.phaseChange === 'pointSet') { st.phase = 'point'; st.point = report.newPoint; }
  if (report.phaseChange === 'pointHit' || report.phaseChange === 'seven_out') { st.phase = 'comeout'; st.point = undefined; }

  // 残高加算 (最終 clamp)
  if (totalPayout > 0) {
    totalPayout = await clampPayout(totalPayout, sid);
    if (totalPayout > 0) txCredit(i.user.id, totalPayout, 'win:craps', sid);
    st.totalReturned += totalPayout;
  }

  // 履歴
  st.history.push(report.log);
  if (st.history.length > 20) st.history.shift();

  setCrapsExposure(sid, openExposure(st));

  // 当選があれば実績通知 (1 roll 内の純利 > 0 なら)
  const wagerDelta = report.resolutions.reduce((s, r) => s + (r.stay ? 0 : r.bet.amount), 0);
  const netThisRoll = totalPayout - wagerDelta;
  if (netThisRoll > 0 && i.guildId) {
    await ach.announce(client, {
      guildId: i.guildId, discordId: i.user.id, game: 'craps',
      bet: wagerDelta, payout: totalPayout, net: netThisRoll,
    });
    ach.recordAchievement({
      guildId: i.guildId, discordId: i.user.id, game: 'craps',
      bet: wagerDelta, payout: totalPayout, net: netThisRoll,
    });
  }

  await updateCrapsMessage(i, sid, st);
}

/* ────────────── BACCARAT ────────────── */

async function onBaccaratButton(i: ButtonInteraction, kind: string, arg: string) {
  if (kind !== 'side') return;
  assertNotBanned(i.user.id);
  const side = arg as BacSide;
  const modal = new ModalBuilder().setCustomId(`bac:amt:${side}`).setTitle(`${L('BACCARAT')} — ${side}`)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId('amt').setLabel(`${L('BET')} (${L('chips')})`).setStyle(TextInputStyle.Short).setRequired(true)
    ));
  return i.showModal(modal);
}

async function doBaccarat(i: ModalSubmitInteraction, side: BacSide, bet: number, mix?: BetMix) {
  assertNotBanned(i.user.id);
  ensureUser(i.user.id);
  if (bet < 10 || bet > 50_000) return i.reply({ content: `${L('BET')} は 10 〜 50,000`, flags: MessageFlags.Ephemeral });
  if (getBalance(i.user.id) < bet) return i.reply({ content: '残高不足', flags: MessageFlags.Ephemeral });
  if (mix) applyMix(i.user.id, -mix.pp, -mix.ltc, 'bet:baccarat');
  else txCredit(i.user.id, -bet, 'bet:baccarat');

  const r = dealBaccaratWithCap(side, bet, await housePayoutCap());
  const mult = bacPayout(side, r.winner);
  const payout = mult > 0 ? await clampPayout(Math.floor(bet * mult)) : 0;
  if (payout > 0) {
    if (mix) payoutByMix(i.user.id, payout, mix, 'win:baccarat');
    else txCredit(i.user.id, payout, 'win:baccarat');
  }

  const buf = await renderBaccarat({ player: r.player, banker: r.banker });
  const file = new AttachmentBuilder(buf, { name: 'bac.png' });
  const net = payout - bet;
  const color = net > 0 ? 0x22c55e : net < 0 ? 0xef4444 : 0x9ca3af;
  const winnerLabel = r.winner === 'tie' ? L('TIE') : r.winner === 'player' ? `${L('PLAYER')} ${L('WINS')}` : `${L('BANKER')} ${L('WINS')}`;
  const msg = net > 0 ? `**${L('YOU')} ${L('WIN')}!** +${net.toLocaleString()} ${L('chips')}`
            : net < 0 ? `**${L('LOSE')}** ${net.toLocaleString()} ${L('chips')}`
            :          `**${L('PUSH')}**`;
  const embed = new EmbedBuilder()
    .setTitle(`🎴 ${L('BACCARAT')}`)
    .setColor(color)
    .setDescription(`${winnerLabel}  —  ${msg}`)
    .addFields(
      { name: L('Player'), value: `**${r.playerTotal}**`, inline: true },
      { name: L('Banker'), value: `**${r.bankerTotal}**`, inline: true },
      { name: L('Bet'),    value: `${side} ${bet.toLocaleString()}`, inline: true },
      { name: L('Balance'), value: `${getBalance(i.user.id).toLocaleString()}`, inline: true },
    )
    .setImage('attachment://bac.png');
  await i.reply({ embeds: [embed], files: [file], flags: MessageFlags.Ephemeral });

  if (mult > 1) await onGameSettled(i, 'baccarat', null, bet, payout);
}

/* ────────────── VIDEO POKER ────────────── */

async function onVpButton(i: ButtonInteraction, kind: string, arg: string) {
  assertNotBanned(i.user.id);
  if (kind === 'deal') {
    if (arg === 'custom') {
      const modal = new ModalBuilder().setCustomId('vp:custombet').setTitle(`${L('VIDEO POKER')} — Custom Bet`)
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('amt').setLabel(`${L('BET')} (${L('chips')})`).setStyle(TextInputStyle.Short).setRequired(true)));
      return i.showModal(modal);
    }
    return startVpSession(i, parseInt(arg, 10));
  }
  if (kind === 'hold' || kind === 'draw') {
    const sid = extractSid(i.message.embeds[0]?.footer?.text);
    if (!sid) return i.reply({ content: 'セッションが見つかりません', flags: MessageFlags.Ephemeral });
    const entry = sessions.get(sid);
    if (!entry || entry.discordId !== i.user.id) return i.reply({ content: 'このセッションは他のユーザーのものです', flags: MessageFlags.Ephemeral });
    const st = entry.state as VPHand;
    if (kind === 'hold') {
      const idx = parseInt(arg, 10);
      if (st.phase === 'deal') st.held[idx] = !st.held[idx];
      return updateVpMessage(i, entry.id, entry.bet, st);
    }
    if (kind === 'draw') {
      if (st.phase === 'deal') drawVPWithCap(st, entry.bet, await housePayoutCap());
      await updateVpMessage(i, entry.id, entry.bet, st);
      if (st.phase === 'drawn' && st.rank) {
        const mult = payoutFor(st.rank);
        if (mult > 0) {
          const payout = await clampPayout(Math.floor(entry.bet * mult));
          if (payout > 0) {
            if (entry.mix) payoutByMix(i.user.id, payout, entry.mix, 'win:videopoker', sid);
            else txCredit(i.user.id, payout, 'win:videopoker');
          }
          await onGameSettled(i, 'videopoker', null, entry.bet, payout);
        }
        sessions.drop(sid);
      }
    }
  }
}

async function startVpSession(i: ButtonInteraction | ModalSubmitInteraction, bet: number, mix?: BetMix) {
  ensureUser(i.user.id);
  if (bet < 10 || bet > 50_000) return i.reply({ content: `${L('BET')} は 10 〜 50,000`, flags: MessageFlags.Ephemeral });
  if (getBalance(i.user.id) < bet) return i.reply({ content: '残高不足', flags: MessageFlags.Ephemeral });
  if (mix) applyMix(i.user.id, -mix.pp, -mix.ltc, 'bet:videopoker');
  else txCredit(i.user.id, -bet, 'bet:videopoker');

  const st = startVP();
  const entry = sessions.create(i.user.id, 'videopoker', st, bet, mix);
  await sendVpEphemeral(i as ButtonInteraction, entry.id, bet, st);
}

const VP_RANK_LABEL: Record<string, string> = {
  royal_flush: 'Royal Flush',
  straight_flush: 'Straight Flush',
  four_of_a_kind: 'Four of a Kind',
  full_house: 'Full House',
  flush: 'Flush',
  straight: 'Straight',
  three_of_a_kind: 'Three of a Kind',
  two_pair: 'Two Pair',
  jacks_or_better: 'Jacks or Better',
  nothing: 'No Win',
};

function buildVpEmbed(sid: string, bet: number, balance: number, st: VPHand): EmbedBuilder {
  const mult = st.phase === 'drawn' && st.rank ? payoutFor(st.rank) : 0;
  const win = Math.floor(bet * mult);
  const net = win - bet;
  const color = st.phase === 'deal' ? 0x3b82f6 : net > 0 ? 0x22c55e : 0x9ca3af;
  const e = new EmbedBuilder().setTitle(`🃏 ${L('VIDEO POKER')}`).setColor(color).setFooter({ text: `sid=${sid}` });
  if (st.phase === 'deal') {
    e.setDescription('HOLD したいカードのボタンを押して [🎴 DRAW] で引き直し');
  } else if (st.rank) {
    const rankLabel = VP_RANK_LABEL[st.rank];
    e.setDescription(net > 0
      ? `**${rankLabel}** — ${L('YOU')} ${L('WIN')} +${net.toLocaleString()} ${L('chips')}`
      : `**${rankLabel}** — ${L('LOSE')} ${(-bet).toLocaleString()} ${L('chips')}`);
  }
  e.addFields(
    { name: L('Bet'), value: `${bet.toLocaleString()} ${L('chips')}`, inline: true },
    { name: L('Balance'), value: `${balance.toLocaleString()}`, inline: true },
    ...(mult > 0 ? [{ name: 'Mult', value: `×${mult}`, inline: true }] : []),
  );
  return e;
}

async function sendVpEphemeral(i: ButtonInteraction, sid: string, bet: number, st: VPHand) {
  const buf = await renderVideoPoker({ cards: st.cards, held: st.held, phase: st.phase });
  const file = new AttachmentBuilder(buf, { name: 'vp.png' });
  const embed = buildVpEmbed(sid, bet, getBalance(i.user.id), st).setImage('attachment://vp.png');
  const rows = st.phase === 'deal' ? vpHoldRow(st.held) : [];
  await (i as any).reply({ embeds: [embed], files: [file], components: rows, flags: MessageFlags.Ephemeral });
}

async function updateVpMessage(i: ButtonInteraction, sid: string, bet: number, st: VPHand) {
  const buf = await renderVideoPoker({ cards: st.cards, held: st.held, phase: st.phase });
  const file = new AttachmentBuilder(buf, { name: 'vp.png' });
  const embed = buildVpEmbed(sid, bet, getBalance(i.user.id), st).setImage('attachment://vp.png');
  const rows = st.phase === 'deal' ? vpHoldRow(st.held) : [];
  await i.update({ embeds: [embed], files: [file], components: rows, attachments: [] });
}

/* ────────────── CASHIER (ユーザー出金) ────────────── */

async function openPaypayWithdrawModal(i: ButtonInteraction | StringSelectMenuInteraction | ChatInputCommandInteraction) {
  const modal = new ModalBuilder().setCustomId('wd:paypay').setTitle('PayPay 出金')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('amt').setLabel(`金額 (¥${MIN_WITHDRAW_JPY.paypay}〜 chip)`).setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('pin').setLabel('リンクのパスコード (4桁, 任意)').setStyle(TextInputStyle.Short).setRequired(false)
          .setMinLength(4).setMaxLength(4)),
    );
  await i.showModal(modal);
}

async function openLtcWithdrawModal(i: ButtonInteraction | StringSelectMenuInteraction | ChatInputCommandInteraction) {
  const modal = new ModalBuilder().setCustomId('wd:ltc').setTitle('LTC 出金')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('amt').setLabel(`金額 (¥${MIN_WITHDRAW_JPY.ltc}〜 chip)`).setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('addr').setLabel('あなたの LTC 受取アドレス').setStyle(TextInputStyle.Short).setRequired(true)),
    );
  await i.showModal(modal);
}

/* ────────────── CASHIER (ユーザー入金) ────────────── */

async function onDepositButton(i: ButtonInteraction, kind: string, _arg: string) {
  assertNotBanned(i.user.id);
  if (kind === 'paypay') return openPaypayDepositModal(i);
  if (kind === 'ltc')    return showLtcAddress(i);
}

async function onSelect(i: StringSelectMenuInteraction) {
  if (i.customId === 'dep:method') {
    assertNotBanned(i.user.id);
    const choice = i.values[0];
    if (choice === 'paypay') return openPaypayDepositModal(i);
    if (choice === 'ltc')    return showLtcAddress(i);
  }
  if (i.customId === 'wd:method') {
    assertNotBanned(i.user.id);
    const choice = i.values[0];
    if (choice === 'paypay') return openPaypayWithdrawModal(i);
    if (choice === 'ltc')    return openLtcWithdrawModal(i);
  }
  if (i.customId === 'rou:select') {
    assertNotBanned(i.user.id);
    const kind = i.values[0];
    return openRouletteAmountModal(i, kind);
  }
  if (i.customId === 'cr:add') {
    assertNotBanned(i.user.id);
    const kind = i.values[0] as CrapsBetKind;
    const sid  = extractSid(i.message.embeds[0]?.footer?.text);
    if (!sid) return i.reply({ content: 'セッションが見つかりません', flags: MessageFlags.Ephemeral });
    const entry = sessions.get(sid);
    if (!entry || entry.discordId !== i.user.id) return i.reply({ content: '他ユーザーのセッションです', flags: MessageFlags.Ephemeral });

    const modal = new ModalBuilder().setCustomId(`cr:bet:${sid}:${kind}`).setTitle(`${L('CRAPS')} — ${kind}`)
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('amt').setLabel(`${L('BET')} (${L('chips')})`).setStyle(TextInputStyle.Short).setRequired(true)
      ));
    return i.showModal(modal);
  }
}

async function openPaypayDepositModal(i: ButtonInteraction | StringSelectMenuInteraction | ChatInputCommandInteraction) {
  const modal = new ModalBuilder().setCustomId('dep:paypay').setTitle('PayPay 送金リンク入金')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('url').setLabel('送金リンク URL または ID').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('pin').setLabel('パスコード (設定していれば)').setStyle(TextInputStyle.Short).setRequired(false)),
    );
  await i.showModal(modal);
}

/** LTC 選択時: 直接モーダルを開いて JPY を入力させる (空欄なら見積なしでアドレスだけ返す) */
async function showLtcAddress(i: ButtonInteraction | StringSelectMenuInteraction | ChatInputCommandInteraction) {
  const modal = new ModalBuilder().setCustomId('dep:ltc').setTitle('LTC 入金')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('jpy').setLabel('入金したい金額 (JPY) — 空欄で見積なし')
          .setStyle(TextInputStyle.Short).setPlaceholder('例: 5000').setRequired(false)
      ),
    );
  await i.showModal(modal);
}

async function replyLtcQuote(i: ModalSubmitInteraction | ButtonInteraction | ChatInputCommandInteraction, jpy: number | null) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const addr = await getOrCreateAddress(i.user.id);
  const rate = await ltcJpyRate().catch(() => null);

  // JPY 未指定: アドレス + 現在レートのみ返す
  if (jpy === null) {
    const embed = new EmbedBuilder()
      .setTitle('💠 LTC 入金')
      .setDescription('下記アドレスに LTC を送金してください。**1承認で自動チャージ**されます。')
      .setColor(0x345d9d)
      .addFields(
        { name: 'Address', value: `\`${addr}\`` },
        { name: L('Rate'), value: rate ? `1 LTC ≈ ¥${rate.toLocaleString()}` : '⚠️ レート取得失敗' },
      );
    return i.editReply({ embeds: [embed] });
  }

  if (!Number.isFinite(jpy) || jpy <= 0)       return i.editReply('❌ 金額が不正');
  if (jpy < MIN_DEPOSIT_JPY.ltc)                return i.editReply(`❌ LTC の最低入金額は ¥${MIN_DEPOSIT_JPY.ltc.toLocaleString()} です`);
  if (jpy > 10_000_000)                         return i.editReply('❌ 金額が大きすぎます');
  if (!rate)                                    return i.editReply('⚠️ レート取得失敗。しばらく経って再度お試しください。');

  const ltc   = +(jpy / rate).toFixed(8);
  const fee   = 0.0001;
  const total = +(ltc + fee).toFixed(8);
  const uri   = `litecoin:${addr}?amount=${ltc}&label=${encodeURIComponent('C4sino deposit')}`;

  const embed = new EmbedBuilder()
    .setTitle(`💠 LTC 入金 — ¥${jpy.toLocaleString()} 相当`)
    .setColor(0x345d9d)
    .addFields(
      { name: 'Address',       value: `\`${addr}\``, inline: false },
      { name: 'Send (LTC)',    value: `\`${ltc}\` LTC`, inline: true },
      { name: 'Est. fee',      value: `~\`${fee.toFixed(8)}\` LTC`, inline: true },
      { name: 'Total send',    value: `~\`${total}\` LTC`, inline: true },
      { name: L('Rate'),       value: `1 LTC ≈ ¥${rate.toLocaleString()}`, inline: false },
      { name: 'Payment URI',   value: `\`\`\`\n${uri}\n\`\`\``, inline: false },
    )
    .setFooter({ text: 'ネットワーク手数料で差分が出ます。実際に着金した金額でチャージされます。' });
  await i.editReply({ embeds: [embed] });
}

async function processPaypayDeposit(discordId: string, linkInput: string, passcode: string | undefined): Promise<{ amount: number; wallet: string }> {
  const code = pp.extractLinkId(linkInput);
  if (!code) throw new Error('PayPay 送金リンクを認識できませんでした');

  const w = wallets.pickPaypayWallet();
  if (!w) throw new Error('有効な PayPay 受取ウォレットが登録されていません。管理者に連絡してください。');

  // 重複受領ガード
  const dup = db.prepare('SELECT 1 FROM deposits WHERE tx_ref=?').get(code);
  if (dup) throw new Error('この送金リンクは既に処理済みです');

  // ログイン不要の check で先に状態を見る
  const pre = await pp.linkCheck(code).catch(() => null);
  if (pre && pre.status !== 'PENDING') throw new Error(`リンク状態: ${pre.status}`);
  if (pre && pre.amount < MIN_DEPOSIT_JPY.paypay)
    throw new Error(`最低入金額は ¥${MIN_DEPOSIT_JPY.paypay.toLocaleString()} です (このリンクは ¥${pre.amount.toLocaleString()})`);

  const r = await wallets.withPaypay(w, t => pp.linkReceive(t, code, passcode));
  wallets.adjustCached(w.id, r.amount);        // 運営 PayPay 残高を即時 +r.amount に更新

  const stmt = db.prepare(`INSERT INTO deposits(discord_id, method, amount_jpy, amount_raw, tx_ref, status, confirmed_at)
    VALUES (?, 'paypay', ?, ?, ?, 'confirmed', strftime('%s','now'))`);
  stmt.run(discordId, r.amount, String(r.amount), code);
  creditRail(discordId, 'pp', r.amount, 'deposit:paypay', code);
  invalidateLiquidityCache();
  return { amount: r.amount, wallet: w.label };
}

/* ────────────── MODAL ────────────── */

/* ────────────── LEET convert button ────────────── */

async function onLeetButton(i: ButtonInteraction) {
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
    return i.reply({ content: '権限が不足しています', flags: MessageFlags.Ephemeral });
  const modal = new ModalBuilder().setCustomId('leet:input').setTitle('LEET 変換')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId('text')
        .setLabel('変換する文字列 (アルファベットが対象)')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1800)
        .setRequired(true)));
  return i.showModal(modal);
}

/* ────────────── Play button (mix bet) ────────────── */

async function onPlayButton(i: ButtonInteraction) {
  assertNotBanned(i.user.id);
  ensureUser(i.user.id);
  // customId: play:<game>[:<subarg>]
  const parts = i.customId.split(':');
  const game = parts[1];
  const sub = parts.slice(2).join(':');
  if (game === 'craps') {
    return i.reply({ content: 'Craps はまだ mix BET に対応していません。`/setup game:craps` のパネルから開始してください。', flags: MessageFlags.Ephemeral });
  }
  const r = getReserves(i.user.id);
  if (r.total <= 0) {
    return i.reply({ content: '残高が 0 です。Cashier で入金してください。', flags: MessageFlags.Ephemeral });
  }
  const subId = sub ? `:${sub}` : '';
  const modal = new ModalBuilder()
    .setCustomId(`play-mix:${game}${subId}`)
    .setTitle(`${game.toUpperCase()} — BET 金額`);
  const rows: ActionRowBuilder<TextInputBuilder>[] = [
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId('pp')
        .setLabel(`PayPay 由来 (保有 ¥${r.pp.toLocaleString()})`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('0 以上の整数 (使わないなら 0)')
        .setValue('0').setRequired(true)),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId('ltc')
        .setLabel(`LTC 由来 (保有 ¥${r.ltc.toLocaleString()})`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('0 以上の整数 (使わないなら 0)')
        .setValue('0').setRequired(true)),
  ];
  if (game === 'roulette' && sub === 'straight') {
    rows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId('num')
        .setLabel('数字 (0〜36)').setStyle(TextInputStyle.Short).setRequired(true)));
  }
  modal.addComponents(...rows);
  return i.showModal(modal);
}

async function handlePlayMixSubmit(i: ModalSubmitInteraction, game: string, sub: string) {
  assertNotBanned(i.user.id);
  const parseAmt = (key: string) => parseInt(i.fields.getTextInputValue(key).replace(/[,\s¥]/g, ''), 10);
  const pp = parseAmt('pp'), ltc = parseAmt('ltc');
  if (!Number.isFinite(pp) || !Number.isFinite(ltc) || pp < 0 || ltc < 0)
    return i.reply({ content: '金額は 0 以上の整数で入力してください', flags: MessageFlags.Ephemeral });
  const total = pp + ltc;
  if (total <= 0) return i.reply({ content: 'PayPay と LTC のどちらかに 1 以上の金額を入れてください', flags: MessageFlags.Ephemeral });
  const r = getReserves(i.user.id);
  if (pp > r.pp)   return i.reply({ content: `PayPay 由来が不足 (保有 ¥${r.pp.toLocaleString()})`, flags: MessageFlags.Ephemeral });
  if (ltc > r.ltc) return i.reply({ content: `LTC 由来が不足 (保有 ¥${r.ltc.toLocaleString()})`, flags: MessageFlags.Ephemeral });
  const mix: BetMix = { pp, ltc };

  switch (game) {
    case 'blackjack':  return startBJ(i, total, mix);
    case 'slots':      return doSpin(i, total, mix);
    case 'videopoker': return startVpSession(i, total, mix);
    case 'baccarat':   return doBaccarat(i, sub as BacSide, total, mix);
    case 'roulette': {
      if (sub === 'straight') {
        const num = parseInt(i.fields.getTextInputValue('num'), 10);
        return doRouletteSpin(i, 'number', total, num, mix);
      }
      return doRouletteSpin(i, sub as RouKind, total, undefined, mix);
    }
    default: return i.reply({ content: `未対応ゲーム: ${game}`, flags: MessageFlags.Ephemeral });
  }
}

async function onModal(i: ModalSubmitInteraction) {
  if (i.customId === 'leet:input') {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
      return i.reply({ content: '権限が不足しています', flags: MessageFlags.Ephemeral });
    const src = i.fields.getTextInputValue('text');
    const converted = L(src);
    const body = `**変換結果:**\n\`\`\`\n${converted}\n\`\`\``;
    return i.reply({ content: body.slice(0, 2000), flags: MessageFlags.Ephemeral });
  }
  if (i.customId.startsWith('play-mix:')) {
    const parts = i.customId.split(':');
    const game = parts[1];
    const sub = parts.slice(2).join(':');
    return handlePlayMixSubmit(i, game, sub);
  }
  if (i.customId === 'bj:custombet') {
    const amt = parseInt(i.fields.getTextInputValue('amt'), 10);
    if (!Number.isFinite(amt)) return i.reply({ content: '不正な数値', flags: MessageFlags.Ephemeral });
    return startBJ(i, amt);
  }
  if (i.customId.startsWith('cr:bet:')) {
    const parts = i.customId.split(':');          // cr:bet:<sid>:<kind>
    const sid = parts[2], kind = parts[3] as CrapsBetKind;
    const raw = i.fields.getTextInputValue('amt').replace(/[,\s¥]/g, '');
    const amt = parseInt(raw, 10);
    return placeCrapsBet(i, sid, kind, amt);
  }
  if (i.customId.startsWith('bac:amt:')) {
    const side = i.customId.split(':')[2] as BacSide;
    const amt  = parseInt(i.fields.getTextInputValue('amt'), 10);
    return doBaccarat(i, side, amt);
  }
  if (i.customId === 'vp:custombet') {
    const amt = parseInt(i.fields.getTextInputValue('amt'), 10);
    return startVpSession(i, amt);
  }
  if (i.customId === 'rou:num') {
    const num = parseInt(i.fields.getTextInputValue('num'), 10);
    const amt = parseInt(i.fields.getTextInputValue('amt'), 10);
    return doRouletteSpin(i, 'number', amt, num);
  }
  if (i.customId.startsWith('rou:amt:')) {
    const kind = i.customId.split(':')[2] as RouKind;
    const amt  = parseInt(i.fields.getTextInputValue('amt'), 10);
    return doRouletteSpin(i, kind, amt);
  }
  if (i.customId === 'slot:custombet') {
    const amt = parseInt(i.fields.getTextInputValue('amt'), 10);
    if (!Number.isFinite(amt)) return i.reply({ content: '不正な数値', flags: MessageFlags.Ephemeral });
    return doSpin(i, amt);
  }
  if (i.customId === 'dep:ltc') {
    assertNotBanned(i.user.id);
    const raw = i.fields.getTextInputValue('jpy').replace(/[,\s¥]/g, '');
    const jpy = raw === '' ? null : parseInt(raw, 10);
    return replyLtcQuote(i, jpy);
  }
  if (i.customId.startsWith('wd:approve:')) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
      return i.reply({ content: '権限不足', flags: MessageFlags.Ephemeral });
    const id = parseInt(i.customId.split(':')[2], 10);
    const txid = i.fields.getTextInputValue('txid').trim();
    try {
      const w = withdraw.markLtcSent(id, txid);
      await i.reply({ content: `✅ LTC 出金 #${id} 完了 (txid=${txid.slice(0,16)}…)`, flags: MessageFlags.Ephemeral });
      const user = await client.users.fetch(w.discord_id).catch(() => null);
      await user?.send(`✅ LTC 出金 #${id} 送信完了。\ntxid: \`${txid}\``).catch(()=>{});
    } catch (e: any) {
      await i.reply({ content: `❌ ${e.message}`, flags: MessageFlags.Ephemeral });
    }
    return;
  }
  if (i.customId === 'wd:paypay') {
    assertNotBanned(i.user.id);
    const amt = parseInt(i.fields.getTextInputValue('amt').replace(/[,\s¥]/g, ''), 10);
    const pin = i.fields.getTextInputValue('pin').trim() || undefined;
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const r = await withdraw.withdrawPayPay(client, { discordId: i.user.id, method: 'paypay', amountJpy: amt, passcode: pin });
      invalidateLiquidityCache();
      await i.editReply(`✅ PayPay 出金 #${r.id} 受付完了。送金リンクを DM 送信しました。`);
    } catch (e: any) {
      await i.editReply(`❌ ${e.message}`);
    }
  }
  if (i.customId === 'wd:ltc') {
    assertNotBanned(i.user.id);
    const amt  = parseInt(i.fields.getTextInputValue('amt').replace(/[,\s¥]/g, ''), 10);
    const addr = i.fields.getTextInputValue('addr').trim();
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const adminCh = i.guildId ? getAdminChannel(i.guildId) : null;
      const r = await withdraw.withdrawLtc(client, adminCh, { discordId: i.user.id, method: 'ltc', amountJpy: amt, dest: addr });
      invalidateLiquidityCache();
      if (r.auto && r.txid) {
        await i.editReply(
          `✅ LTC 出金 #${r.id} 送信完了\n` +
          `**${r.ltcAmount} LTC** → \`${addr}\`\n` +
          `txid: \`${r.txid}\`  (ネットワーク反映まで数分〜十数分)`
        );
      } else {
        await i.editReply(
          `✅ LTC 出金 #${r.id} 受付完了\n` +
          `**${r.ltcAmount} LTC** → \`${addr}\`\n` +
          `処理には少し時間がかかります。完了次第 DM で txid をお知らせします。`
        );
      }
    } catch (e: any) {
      await i.editReply(`❌ ${e.message}`);
    }
  }
  if (i.customId === 'dep:paypay') {
    assertNotBanned(i.user.id);
    const url = i.fields.getTextInputValue('url');
    const pin = i.fields.getTextInputValue('pin').trim() || undefined;
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const r = await processPaypayDeposit(i.user.id, url, pin);
      await i.editReply(`✅ PayPay ¥${r.amount.toLocaleString()} を受領（wallet: \`${r.wallet}\`）。残高に加算しました。`);
    } catch (e: any) {
      await i.editReply(`❌ ${e.message}`);
    }
  }
  if (i.customId.startsWith('wallet:paypay:start:')) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
      return i.reply({ content: '権限不足', flags: MessageFlags.Ephemeral });
    const label = decodeURIComponent(i.customId.split(':')[3]);
    const phone = i.fields.getTextInputValue('phone');
    const password = i.fields.getTextInputValue('password');
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const r = await pp.loginStart(phone, password);
      paypayLoginFlow.set(i.user.id, { sess: r.session, label, phone });
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('wallet:paypay:url').setLabel('SMS の URL を入力').setStyle(ButtonStyle.Primary)
      );
      await i.editReply({ content: `📱 SMS を送信しました。届いた URL (またはIDのみ) を次で入力してください。`, components: [row] });
    } catch (e: any) {
      await i.editReply(`❌ ${e.message}`);
    }
  }
  if (i.customId === 'wallet:paypay:finish') {
    const url = i.fields.getTextInputValue('url').trim();
    const flow = paypayLoginFlow.get(i.user.id);
    if (!flow) return i.reply({ content: 'ログインフローが見つかりません。最初からやり直してください。', flags: MessageFlags.Ephemeral });
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const tokens = await pp.loginFinish(flow.sess, url);
      const id = wallets.addPaypayWallet(i.user.id, flow.label, flow.phone, tokens);
      paypayLoginFlow.delete(i.user.id);
      await i.editReply(`✅ PayPay ウォレット追加 (#${id}) — ${tokens.name ?? 'account'} として登録`);
    } catch (e: any) {
      await i.editReply(`❌ ${e.message}`);
    }
  }
}

// PayPay URL 入力ボタン → モーダル
client.on(Events.InteractionCreate, async (i) => {
  if (!i.isButton() || i.customId !== 'wallet:paypay:url') return;
  const modal = new ModalBuilder().setCustomId('wallet:paypay:finish').setTitle('PayPay SMS URL 入力')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId('url').setLabel('SMS 内の URL または ID').setStyle(TextInputStyle.Short).setRequired(true)
    ));
  await i.showModal(modal);
});

/* ────────────── LTC 入金ポーリング ────────────── */

async function ltcPoll() {
  if (!process.env.LTC_API_TOKEN) return;
  const rows = db.prepare('SELECT discord_id, address FROM ltc_addresses').all() as { discord_id: string; address: string }[];
  const rate = await ltcJpyRate().catch(() => null);
  if (!rate) return;
  for (const row of rows) {
    const txs = await checkDeposits(row.address).catch(() => []);
    for (const tx of txs) {
      const exists = db.prepare('SELECT 1 FROM deposits WHERE tx_ref=?').get(tx.txid);
      if (exists) continue;
      const jpy = Math.floor(tx.value_ltc * rate);
      if (jpy < MIN_DEPOSIT_JPY.ltc) {
        console.warn(`[ltc-poll] ${tx.txid} too small: ¥${jpy} < ¥${MIN_DEPOSIT_JPY.ltc}`);
        // 最低額未満は無視 (ユーザーには DM で通知)
        const user = await client.users.fetch(row.discord_id).catch(() => null);
        await user?.send(`⚠️ LTC ${tx.value_ltc} (≈ ¥${jpy.toLocaleString()}) を検出しましたが、最低入金額 ¥${MIN_DEPOSIT_JPY.ltc.toLocaleString()} 未満のため処理されませんでした。`).catch(() => {});
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
        await user?.send(`✅ LTC ${tx.value_ltc} (≈ ¥${jpy.toLocaleString()}) を受信。残高に加算しました。`).catch(() => {});
      } catch { /* dup */ }
    }
  }
}
setInterval(ltcPoll, 60_000);

/* ────────────── PayPay keepalive ────────────── */

async function paypayAliveAndRefresh() {
  if (!process.env.PAYPAY_SIDECAR_URL) return;
  const rows = wallets.listWallets('paypay').filter(w => w.enabled && w.access_token);
  for (const w of rows) {
    try {
      await wallets.withPaypay(w, t => pp.alive(t));
      const b = await wallets.withPaypay(w, t => pp.walletBalance(t));
      wallets.touchUsed(w.id, b.usable_balance);
    } catch (e) { console.warn(`[paypay-alive] #${w.id}:`, (e as Error).message); }
  }
  invalidateLiquidityCache();
}
setInterval(paypayAliveAndRefresh, 5 * 60_000);
// 起動直後にも 1 回
setTimeout(paypayAliveAndRefresh, 10_000);

client.login(process.env.DISCORD_TOKEN);
