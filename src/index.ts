import 'dotenv/config';
import {
  Client, GatewayIntentBits, Partials, AttachmentBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, ActionRowBuilder, Events, PermissionFlagsBits,
  EmbedBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction,
  ButtonInteraction, ModalSubmitInteraction, StringSelectMenuInteraction, MessageFlags,
} from 'discord.js';
import { db, getBalance, txCredit, ensureUser, isBanned, assertNotBanned, creditRail, getReserves } from './db/schema.js';
import * as sessions from './games/session-store.js';
import {
  openTable, replayInPlace, onTableButton, onTableSelect, onTableModal,
  onBlackjackAction, onVideoPokerAction, onCrapsAction, isGame, setTablesClient, type Game,
} from './tables.js';
import { depositPanel, depositMethodPicker, withdrawMethodPicker, balanceReply, leetPanel, mwsPanel, mwsWarningText, replayRowFromCtx, publicGamePanel } from './ui/panels.js';
import * as mws from './mws/timer.js';
import * as pp from './payments/paypay-client.js';
import * as wallets from './payments/wallets.js';
import { getOrCreateAddress, checkDeposits, ltcJpyRate } from './payments/ltc.js';
import { invalidateLiquidityCache, maxAffordableBet, assertOperatorWithdrawSafe } from './payments/liquidity.js';
import { MIN_DEPOSIT_JPY, MIN_WITHDRAW_JPY } from './payments/limits.js';
import * as withdraw from './payments/withdraw.js';
import { L } from './ui/leet.js';
import { gameOverview, type GameKey } from './ui/overview.js';
import * as ach from './achievements.js';
import {
  removeGuildAutoMod, removeAutoModInAllGuilds, AUTOMOD_RULE_NAME,
  listBannedWords, addBannedWord, removeBannedWord,
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

setTablesClient(client);

client.once(Events.ClientReady, async c => {
  console.log(`[bot] online as ${c.user.tag}`);
  // スラッシュコマンドの起動時自動登録 (SKIP_COMMAND_REGISTER=1 で無効化可能)
  if (process.env.SKIP_COMMAND_REGISTER !== '1') {
    try {
      const { registerSlashCommands } = await import('./register-commands.js');
      await registerSlashCommands();
    } catch (e) {
      console.error('[register] auto-register failed:', (e as Error).message);
    }
  }
  // 平文で DB に残っている既存の secrets を暗号化 (MASTER_ENC_KEY 必須)
  try {
    wallets.migrateEncryptPlaintextSecrets();
    wallets.migrateEncryptLtcAddressDerivations();
  } catch (e) {
    console.error('[crypto] migration failed:', (e as Error).message);
  }
  // active のまま残っていたセッションを abandoned に遷移 + BET を refund (比率不明時は PP に寄せる)
  try {
    sessions.recoverActiveSessions((discordId, amount, reason, ref) => {
      // mix 情報は DB から復元できる (session.mix)。ここでは txCredit で現比率に按分で戻す。
      txCredit(discordId, amount, reason, ref);
    });
  } catch (e) {
    console.error('[sessions] recover failed:', (e as Error).message);
  }
  // Webhook rewrite 方式に切り替えたため、旧 AutoMod ブロックルールが残っていたら削除する
  try { await removeAutoModInAllGuilds(c as unknown as { guilds: { cache: Map<string, any> } }); }
  catch (e) { console.error('[automod] cleanup failed:', (e as Error).message); }
  // MWS 延長タイマーの定期監視: 10 分間隔で残り時間を確認し、24h/6h/1h 閾値を跨いだら通知
  startMwsTicker();
});

/** MWS 延長タイマーの定期 tick (10 分間隔)。startup / クラッシュ復旧時に呼ぶ。 */
function startMwsTicker() {
  const run = async () => {
    try {
      const result = mws.evaluateTick();
      if (!result || !result.state.notifyChannelId) return;
      const ch = await client.channels.fetch(result.state.notifyChannelId).catch(() => null);
      if (!ch || !('send' in ch)) return;
      const roleMention = result.state.notifyRoleId ? `<@&${result.state.notifyRoleId}>` : null;
      const text = mwsWarningText(result.bucket as 24|6|1|'expired', result.state, roleMention);
      await (ch as any).send({ content: text, allowedMentions: { roles: result.state.notifyRoleId ? [result.state.notifyRoleId] : [] } }).catch(() => {});
    } catch (e) {
      console.error('[mws] tick failed:', (e as Error).message);
    }
  };
  // 起動直後に 1 回、その後 10 分おき
  run();
  setInterval(run, 10 * 60 * 1000);
}

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
    case 'banned-words': return cmdBannedWords(i);
    case 'paypay':       return cmdPaypay(i);
    case 'leet':         return cmdLeet(i);
    case 'mws':          return cmdMws(i);
    case 'blackjack':  return installPlayPanel(i, 'blackjack');
    case 'slots':      return installPlayPanel(i, 'slots');
    case 'roulette':   return installPlayPanel(i, 'roulette');
    case 'baccarat':   return installPlayPanel(i, 'baccarat');
    case 'videopoker': return installPlayPanel(i, 'videopoker');
    case 'craps':      return installPlayPanel(i, 'craps');
  }
}

/* ────────────── /GAME: install Play panel ────────────── */

async function installPlayPanel(i: ChatInputCommandInteraction, game: Game) {
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageChannels))
    return i.reply({ content: '権限が不足しています', flags: MessageFlags.Ephemeral });
  if (!i.channel || !('send' in i.channel)) return i.reply({ content: 'このチャンネルには設置できません', flags: MessageFlags.Ephemeral });
  const msg = await i.channel.send(publicGamePanel(game));
  db.prepare('INSERT OR REPLACE INTO panels(guild_id,channel_id,message_id,game) VALUES (?,?,?,?)')
    .run(i.guildId!, i.channelId, msg.id, game);
  await i.reply({ content: `✅ ${game} 卓を設置しました`, flags: MessageFlags.Ephemeral });
}

async function cmdBannedWords(i: ChatInputCommandInteraction) {
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
    return i.reply({ content: '権限が不足しています', flags: MessageFlags.Ephemeral });
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
    const words = listBannedWords(i.guild.id);
    // 説明欄の上限 4096 文字に収まる所まで並べ、残りは件数だけ出す
    let body = '';
    let shown = 0;
    for (const r of words) {
      const piece = `${shown ? ', ' : ''}\`${r.word}\``;
      if (body.length + piece.length > 3900) break;
      body += piece; shown++;
    }
    if (shown < words.length) body += ` … ほか ${words.length - shown} 語`;
    const embed = new EmbedBuilder()
      .setTitle(`🚫 NG ワード一覧 (${words.length})`)
      .setColor(0xd4af37)
      .setDescription(body || '_(なし)_')
      .setFooter({ text: 'どの語も /banned-words remove で削除できます' });
    return i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}

async function cmdWithdraw(i: ChatInputCommandInteraction) {
  assertNotBanned(i.user.id);
  const method = i.options.getString('method', true) as 'paypay' | 'ltc';
  if (method === 'paypay') return openPaypayWithdrawModal(i);
  return openLtcWithdrawModal(i);
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
  const type = i.options.getString('type', true) as 'panel' | 'overview';
  const game = i.options.getString('game', true);
  if (!i.channel || !('send' in i.channel)) return i.reply({ content: 'このチャンネルには設置できません', flags: MessageFlags.Ephemeral });

  if (type === 'overview') {
    await i.channel.send({ embeds: [gameOverview(game as GameKey)] });
    return i.reply({ content: `✅ ${game} 概要パネルを設置`, flags: MessageFlags.Ephemeral });
  }

  // type === 'panel': インタラクティブなベット/操作用パネル。all は overview 専用。
  if (game === 'all') return i.reply({ content: 'all は overview でのみ使用可能 (type:overview を指定)', flags: MessageFlags.Ephemeral });
  const payload = isGame(game) ? publicGamePanel(game) : depositPanel();
  const msg = await i.channel.send(payload);
  db.prepare('INSERT OR REPLACE INTO panels(guild_id,channel_id,message_id,game) VALUES (?,?,?,?)')
    .run(i.guildId!, i.channelId, msg.id, game);
  await i.reply({ content: `✅ ${game} パネルを設置`, flags: MessageFlags.Ephemeral });
}

async function cmdMws(i: ChatInputCommandInteraction) {
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageChannels))
    return i.reply({ content: '権限が不足しています', flags: MessageFlags.Ephemeral });
  if (!i.channel || !('send' in i.channel)) return i.reply({ content: 'このチャンネルには設置できません', flags: MessageFlags.Ephemeral });
  const msg = await i.channel.send(mwsPanel(mws.getState()));
  db.prepare('INSERT OR REPLACE INTO panels(guild_id,channel_id,message_id,game) VALUES (?,?,?,?)')
    .run(i.guildId!, i.channelId, msg.id, 'mws');
  await i.reply({ content: '✅ MWS タイマーパネルを設置', flags: MessageFlags.Ephemeral });
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
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
    return i.reply({ content: '権限が不足しています', flags: MessageFlags.Ephemeral });
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
      const { isValidLtcAddress } = await import('./payments/ltc-address.js');
      if (!isValidLtcAddress(address))
        return i.reply({ content: 'LTC アドレスではありません (L / M / ltc1 のみ受付)', flags: MessageFlags.Ephemeral });
      const id = wallets.addLtcWallet(i.user.id, label, address);
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

/** モーダル入力を厳密パース: 整数のみ受付 (NaN, 小数, 文字混入はすべて null)。
 *  許容: 先頭末尾の空白、カンマ区切り、¥ 記号。 */
function parseStrictInt(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = raw.replace(/[,\s¥]/g, '');
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

/** ledger の reason を人間向けに整形: 'bet:blackjack' → 'BET Blackjack' など */
function formatReason(reason: string): string {
  const [head, ...rest] = reason.split(':');
  const tail = rest.join(':');
  const gameLabel: Record<string, string> = {
    blackjack: 'Blackjack', slots: 'Slots', roulette: 'Roulette',
    baccarat: 'Baccarat', videopoker: 'Video Poker', craps: 'Craps',
  };
  switch (head) {
    case 'bet':    return `BET ${gameLabel[tail] ?? tail}`;
    case 'win':    return `WIN ${gameLabel[tail] ?? tail}`;
    case 'deposit':return `DEPOSIT ${tail.toUpperCase()}`;
    case 'withdraw': return `WITHDRAW ${tail.toUpperCase()}`;
    case 'admin':  return `ADMIN ${tail}`;
    case 'grant':  return `GRANT ${tail.replace(':',' ')}`;
    case 'revoke': return `REVOKE ${tail.replace(':',' ')}`;
    case 'refund': return `REFUND ${tail}`;
    default: return reason;
  }
}
function formatLedgerLine(delta: number, reason: string, ref: string | null): string {
  const sign = delta >= 0 ? '+' : '';
  return `\`${sign}¥${delta.toLocaleString()}\` ${formatReason(reason)}${ref ? ` \`(${ref.slice(0,16)})\`` : ''}`;
}

async function cmdAdmin(i: ChatInputCommandInteraction) {
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
                .addFields(
                  { name: '実行者', value: `<@${i.user.id}>`, inline: true },
                  { name: '対象', value: `<@${u.id}>`, inline: true },
                  { name: 'delta', value: `${delta>=0?'+':''}${delta.toLocaleString()}`, inline: true },
                  { name: '理由', value: reason },
                );
              await (ch as any).send({ embeds: [embed] });
            }
          } catch { /* best-effort */ }
        }
      }
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
  if (sub === 'history') {
    const u = i.options.getUser('user', true);
    const type = (i.options.getString('type') ?? 'all') as 'all'|'bets'|'wins'|'deposits'|'withdrawals'|'grants';
    const limit = i.options.getInteger('limit') ?? 20;
    ensureUser(u.id);
    await i.deferReply({ flags: MessageFlags.Ephemeral });

    type Row = { at: number; kind: string; delta: number; label: string; ref: string };
    const rows: Row[] = [];

    if (type === 'all' || type === 'bets') {
      const r = db.prepare(`SELECT delta, reason, ref, created_at FROM ledger WHERE discord_id=? AND reason LIKE 'bet:%' ORDER BY id DESC LIMIT ?`).all(u.id, limit) as any[];
      for (const t of r) rows.push({ at: t.created_at, kind: 'BET', delta: t.delta, label: formatReason(t.reason), ref: t.ref ?? '' });
    }
    if (type === 'all' || type === 'wins') {
      const r = db.prepare(`SELECT delta, reason, ref, created_at FROM ledger WHERE discord_id=? AND reason LIKE 'win:%' ORDER BY id DESC LIMIT ?`).all(u.id, limit) as any[];
      for (const t of r) rows.push({ at: t.created_at, kind: 'WIN', delta: t.delta, label: formatReason(t.reason), ref: t.ref ?? '' });
    }
    if (type === 'all' || type === 'deposits') {
      const r = db.prepare(`SELECT method, amount_jpy, tx_ref, status, created_at FROM deposits WHERE discord_id=? ORDER BY created_at DESC LIMIT ?`).all(u.id, limit) as any[];
      for (const d of r) rows.push({
        at: d.created_at, kind: 'DEPOSIT',
        delta: d.status === 'confirmed' ? d.amount_jpy : 0,
        label: `${d.method.toUpperCase()} (${d.status})`, ref: d.tx_ref ?? '',
      });
    }
    if (type === 'all' || type === 'withdrawals') {
      const r = db.prepare(`SELECT id, method, amount_jpy, dest, tx_ref, link_url, status, reason, created_at FROM withdrawals WHERE discord_id=? ORDER BY created_at DESC LIMIT ?`).all(u.id, limit) as any[];
      for (const w of r) rows.push({
        at: w.created_at, kind: 'WITHDRAW',
        delta: w.status === 'sent' ? -w.amount_jpy : 0,
        label: `${w.method.toUpperCase()} #${w.id} (${w.status})${w.dest?` → ${(''+w.dest).slice(0,14)}…`:''}${w.reason?` [${w.reason}]`:''}`,
        ref: w.tx_ref ?? '',
      });
    }
    if (type === 'all' || type === 'grants') {
      const r = db.prepare(`SELECT delta, reason, ref, created_at FROM ledger WHERE discord_id=? AND (reason LIKE 'admin:%' OR reason LIKE 'grant:%' OR reason LIKE 'revoke:%' OR reason LIKE 'refund%') ORDER BY id DESC LIMIT ?`).all(u.id, limit) as any[];
      for (const t of r) rows.push({ at: t.created_at, kind: 'ADMIN', delta: t.delta, label: formatReason(t.reason), ref: t.ref ?? '' });
    }

    rows.sort((a, b) => b.at - a.at);
    const shown = rows.slice(0, limit);

    const lines = shown.map(r => {
      const sign = r.delta === 0 ? '  ' : r.delta > 0 ? '+ ' : '− ';
      const amt  = r.delta === 0 ? '      ' : Math.abs(r.delta).toLocaleString().padStart(7);
      return `\`<t:${r.at}:f>\` **${r.kind.padEnd(8)}** \`${sign}¥${amt}\` ${r.label}${r.ref?` \`(${r.ref.slice(0,16)})\``:''}`;
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

    const bets = (db.prepare(`SELECT COALESCE(SUM(-delta),0) s FROM ledger WHERE discord_id=? AND reason LIKE 'bet:%'`).get(u.id) as any).s as number;
    const wins = (db.prepare(`SELECT COALESCE(SUM(delta),0)  s FROM ledger WHERE discord_id=? AND reason LIKE 'win:%'`).get(u.id) as any).s as number;
    const depConfirmed = db.prepare(`SELECT method, COALESCE(SUM(amount_jpy),0) s FROM deposits WHERE discord_id=? AND status='confirmed' GROUP BY method`).all(u.id) as Array<{method:string;s:number}>;
    const wdSent = db.prepare(`SELECT method, COALESCE(SUM(amount_jpy),0) s FROM withdrawals WHERE discord_id=? AND status='sent' GROUP BY method`).all(u.id) as Array<{method:string;s:number}>;
    const ban = db.prepare('SELECT reason, banned_at FROM user_bans WHERE discord_id=?').get(u.id) as { reason:string; banned_at:number } | undefined;

    const lastTx = db.prepare(`SELECT delta, reason, ref, created_at FROM ledger WHERE discord_id=? ORDER BY id DESC LIMIT 10`).all(u.id) as Array<{delta:number;reason:string;ref:string|null;created_at:number}>;
    const openWd = db.prepare(`SELECT id, method, amount_jpy, status, created_at FROM withdrawals WHERE discord_id=? AND status IN ('pending','sent','failed') ORDER BY created_at DESC LIMIT 10`).all(u.id) as any[];
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
        { name: '直近出金 (10件)', value: openWd.length
          ? openWd.map(w => {
              const m = w.status==='pending'?'🟡':w.status==='sent'?'🟢':'🔴';
              return `#${w.id} ${m} \`<t:${w.created_at}:f>\` ${w.method} ¥${w.amount_jpy.toLocaleString()}`;
            }).join('\n').slice(0, 1024)
          : '_(なし)_', inline: false },
        { name: '直近取引 10 件 (ledger)', value: lastTx.length
          ? lastTx.map(t => `\`<t:${t.created_at}:f>\` ${formatLedgerLine(t.delta, t.reason, t.ref)}`).join('\n').slice(0, 1024)
          : '_(なし)_', inline: false },
      )
      .setFooter({ text: '詳細履歴は /admin history user:... · chip 付与は /admin grant · 制裁は /admin ban / unban' });

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
    const { isValidLtcAddress } = await import('./payments/ltc-address.js');
    if (!isValidLtcAddress(dest))
      return i.reply({ content: '❌ LTC アドレスではありません (L / M / ltc1 のみ受付)', flags: MessageFlags.Ephemeral });
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
  if (ns === 't') return onTableButton(i);            // t:<game>:<action>[:arg] (テーブル上の操作)
  if (ns === 'play') {                                // play:<game>[:<賭け先/掛け方>] (チャンネルのパネル)
    if (!isGame(kind)) return;
    const opt = kind === 'roulette' && arg === 'straight' ? 'number' : arg;
    return openTable(i, kind, opt);
  }
  if (ns === 'replay' && isGame(kind)) return replayInPlace(i, kind);
  if (ns === 'leet' && kind === 'convert') return onLeetButton(i);
  if (ns === 'bj') {
    if (kind === 'act') return onBlackjackAction(i, arg as 'hit' | 'stand' | 'double' | 'split');
    return openTable(i, 'blackjack');                 // 以前のパネルの固定額ボタン
  }
  if (ns === 'vp') {
    if (kind === 'hold' || kind === 'draw') return onVideoPokerAction(i, kind, arg);
    return openTable(i, 'videopoker');
  }
  if (ns === 'cr') {
    if (kind === 'roll' || kind === 'undo' || kind === 'end') return onCrapsAction(i, kind);
    return openTable(i, 'craps');
  }
  if (ns === 'slot') return openTable(i, 'slots');
  if (ns === 'rou')  return openTable(i, 'roulette');
  if (ns === 'bac')  return openTable(i, 'baccarat', kind === 'side' ? arg : undefined);
  if (ns === 'dep') return onDepositButton(i, kind, i.customId.split(':').slice(2).join(':'));
  if (ns === 'adm') return onAdminButton(i, kind);
  if (ns === 'wd' && (kind === 'approve' || kind === 'reject')) return onWithdrawAdmin(i, kind, arg);
  if (ns === 'wd' && (kind === 'open' || kind === 'paypay' || kind === 'ltc')) return onWithdrawUserButton(i, kind);
  if (ns === 'mws') return onMwsButton(i, kind);
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
async function onMwsButton(i: ButtonInteraction, kind: string) {
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

/** ctx (<game>[:<sub>]) はゲームのリザルト画面から来た入金のとき。完了画面に同じゲームの Replay を付ける。 */
async function onDepositButton(i: ButtonInteraction, kind: string, ctx: string) {
  assertNotBanned(i.user.id);
  if (kind === 'open')   return i.reply({ ...depositMethodPicker(ctx), flags: MessageFlags.Ephemeral });
  if (kind === 'paypay') return openPaypayDepositModal(i, ctx);
  if (kind === 'ltc')    return showLtcAddress(i, ctx);
}

async function onWithdrawUserButton(i: ButtonInteraction, kind: string) {
  assertNotBanned(i.user.id);
  if (kind === 'open')   return i.reply({ ...withdrawMethodPicker(), flags: MessageFlags.Ephemeral });
  if (kind === 'paypay') return openPaypayWithdrawModal(i);
  if (kind === 'ltc')    return openLtcWithdrawModal(i);
}

async function onSelect(i: StringSelectMenuInteraction) {
  if (i.customId.startsWith('t:') || i.customId === 'cr:add') return onTableSelect(i);
  // 以前のルーレット画面に残っている掛け方メニュー: 新しいテーブルを開き直す
  if (i.customId === 'rou:select') return openTable(i as unknown as ButtonInteraction, 'roulette');
}

async function openPaypayDepositModal(i: ButtonInteraction | StringSelectMenuInteraction | ChatInputCommandInteraction, ctx = '') {
  const modal = new ModalBuilder().setCustomId(`dep:paypay${ctx ? `:${ctx}` : ''}`).setTitle('PayPay 送金リンク入金')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('url').setLabel('送金リンク URL または ID').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('pin').setLabel('パスコード (設定していれば)').setStyle(TextInputStyle.Short).setRequired(false)),
    );
  await i.showModal(modal);
}

/** LTC 選択時: 直接モーダルを開いて JPY を入力させる (空欄なら見積なしでアドレスだけ返す) */
async function showLtcAddress(i: ButtonInteraction | StringSelectMenuInteraction | ChatInputCommandInteraction, ctx = '') {
  const modal = new ModalBuilder().setCustomId(`dep:ltc${ctx ? `:${ctx}` : ''}`).setTitle('LTC 入金')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('jpy').setLabel('入金したい金額 (JPY) — 空欄で見積なし')
          .setStyle(TextInputStyle.Short).setPlaceholder('例: 5000').setRequired(false)
      ),
    );
  await i.showModal(modal);
}

async function replyLtcQuote(i: ModalSubmitInteraction | ButtonInteraction | ChatInputCommandInteraction, jpy: number | null, ctx = '') {
  const inPlace = !!ctx && i.isModalSubmit() && i.isFromMessage();
  if (inPlace && i.isModalSubmit() && i.isFromMessage()) await i.deferUpdate();
  else await i.deferReply({ flags: MessageFlags.Ephemeral });
  const replayNote = '着金は 1 承認後に自動で残高へ反映され、DM でお知らせします。着金後に Replay でゲームに戻れます。';
  const rows = ctx ? [replayRowFromCtx(ctx)] : [];
  const fail = (msg: string) => i.editReply({ content: msg, embeds: [], components: rows });
  const show = (embed: EmbedBuilder) => {
    if (ctx) embed.setDescription(`${embed.data.description ? `${embed.data.description}\n\n` : ''}${replayNote}`);
    return i.editReply({ content: '', embeds: [embed], components: rows });
  };
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
    return show(embed);
  }

  if (!Number.isFinite(jpy) || jpy <= 0)       return fail('❌ 金額が不正');
  if (jpy < MIN_DEPOSIT_JPY.ltc)                return fail(`❌ LTC の最低入金額は ¥${MIN_DEPOSIT_JPY.ltc.toLocaleString()} です`);
  if (jpy > 10_000_000)                         return fail('❌ 金額が大きすぎます');
  if (!rate)                                    return fail('⚠️ レート取得失敗。しばらく経って再度お試しください。');

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
  await show(embed);
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

async function onModal(i: ModalSubmitInteraction) {
  if (i.customId === 'leet:input') {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
      return i.reply({ content: '権限が不足しています', flags: MessageFlags.Ephemeral });
    const src = i.fields.getTextInputValue('text');
    // 中身だけのコードブロックにする。``` が混ざるとブロックが閉じるので崩し、
    // 2000 文字に収まるよう本文側を切って閉じ記号は必ず残す。
    const converted = L(src).replace(/```/g, '`​``').slice(0, 2000 - 8);
    return i.reply({ content: `\`\`\`\n${converted}\n\`\`\``, flags: MessageFlags.Ephemeral });
  }
  if (i.customId.startsWith('t:')) return onTableModal(i);
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
    const amt = parseStrictInt(i.fields.getTextInputValue('amt'));
    if (amt === null) return i.reply({ content: '金額は整数で入力してください', flags: MessageFlags.Ephemeral });
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
    const amt  = parseStrictInt(i.fields.getTextInputValue('amt'));
    if (amt === null) return i.reply({ content: '金額は整数で入力してください', flags: MessageFlags.Ephemeral });
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
  if (i.customId === 'dep:paypay' || i.customId.startsWith('dep:paypay:')) {
    assertNotBanned(i.user.id);
    const ctx = i.customId.split(':').slice(2).join(':');
    const url = i.fields.getTextInputValue('url');
    const pin = i.fields.getTextInputValue('pin').trim() || undefined;
    // ゲームから来た入金は、入金方法の選択画面をそのまま完了画面に書き換えて Replay を付ける
    const inPlace = !!ctx && i.isFromMessage();
    if (inPlace && i.isFromMessage()) await i.deferUpdate();
    else await i.deferReply({ flags: MessageFlags.Ephemeral });
    const rows = ctx ? [replayRowFromCtx(ctx)] : [];
    try {
      const r = await processPaypayDeposit(i.user.id, url, pin);
      await i.editReply({ content: `✅ PayPay ¥${r.amount.toLocaleString()} を受領（wallet: \`${r.wallet}\`）。残高に加算しました。`, embeds: [], components: rows });
    } catch (e: any) {
      await i.editReply({ content: `❌ ${e.message}`, embeds: [], components: rows });
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
    } catch (e) { console.warn(`[paypay-sync] #${w.id}:`, (e as Error).message); }
  }
  invalidateLiquidityCache();
}
setInterval(paypayPeriodicSync, 5 * 60_000);
// 起動直後にも 1 回
setTimeout(paypayPeriodicSync, 10_000);

client.login(process.env.DISCORD_TOKEN);
