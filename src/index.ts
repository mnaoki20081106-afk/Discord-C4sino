import 'dotenv/config';
import {
  Client, GatewayIntentBits, Partials, AttachmentBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, ActionRowBuilder, Events, PermissionFlagsBits,
  EmbedBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction,
  ButtonInteraction, ModalSubmitInteraction, StringSelectMenuInteraction, MessageFlags,
} from 'discord.js';
import { db, getBalance, txCredit, ensureUser, isBanned, assertNotBanned } from './db/schema.js';
import * as sessions from './games/session-store.js';
import { startHand, availableActions, apply, newShoe, isBlackjack, type BJState } from './games/blackjack.js';
import { spin, reelStrip } from './games/slots.js';
import { renderBlackjack } from './ui/render-table.js';
import { renderSlots } from './ui/render-slots.js';
import { blackjackPanel, slotsPanel, depositPanel, bjActionsRow } from './ui/panels.js';
import * as pp from './payments/paypay-client.js';
import * as wallets from './payments/wallets.js';
import { getOrCreateAddress, checkDeposits, ltcJpyRate } from './payments/ltc.js';
import { L } from './ui/leet.js';
import { gameOverview, type GameKey } from './ui/overview.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel],
});

db.exec(`CREATE TABLE IF NOT EXISTS guild_config (
  guild_id TEXT PRIMARY KEY,
  admin_channel_id TEXT
);`);

function getAdminChannel(guildId: string): string | null {
  const r = db.prepare('SELECT admin_channel_id FROM guild_config WHERE guild_id=?').get(guildId) as { admin_channel_id: string } | undefined;
  return r?.admin_channel_id ?? null;
}

// PayPay ログイン進行状態 (discordUserId -> { sidecarSession, label, phone, guildId })
const paypayLoginFlow = new Map<string, { sess: string; label: string; phone: string }>();

client.once(Events.ClientReady, c => console.log(`[bot] online as ${c.user.tag}`));

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
    case 'overview': return cmdOverview(i);
  }
}

async function cmdOverview(i: ChatInputCommandInteraction) {
  const g = (i.options.getString('game') ?? 'all') as GameKey;
  await i.reply({ embeds: [gameOverview(g)], flags: MessageFlags.Ephemeral });
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
  const payload = game === 'blackjack' ? blackjackPanel()
               : game === 'slots'     ? slotsPanel()
               : depositPanel();
  if (!i.channel || !('send' in i.channel)) return i.reply({ content: 'このチャンネルには設置できません', flags: MessageFlags.Ephemeral });
  const msg = await i.channel.send(payload);
  db.prepare('INSERT OR REPLACE INTO panels(guild_id,channel_id,message_id,game) VALUES (?,?,?,?)')
    .run(i.guildId!, i.channelId, msg.id, game);
  await i.reply({ content: `✅ ${game} パネルを設置`, flags: MessageFlags.Ephemeral });
}

async function cmdBalance(i: ChatInputCommandInteraction) {
  const bal = getBalance(i.user.id);
  await i.reply({ content: `💰 残高: **${bal.toLocaleString()} ${L('chips')}**`, flags: MessageFlags.Ephemeral });
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
    const address = i.options.getString('address', true).trim();
    if (!/^[A-HJ-NP-Za-km-z1-9]{25,100}$|^ltc1[0-9a-z]{25,100}$/.test(address))
      return i.reply({ content: 'LTC アドレスの形式が不正です', flags: MessageFlags.Ephemeral });
    const id = wallets.addLtcWallet(i.user.id, label, address);
    return i.reply({ content: `✅ LTC ウォレット追加 (id=${id})`, flags: MessageFlags.Ephemeral });
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
    const users = (db.prepare('SELECT COUNT(*) c FROM users').get() as any).c;
    const chips = (db.prepare('SELECT COALESCE(SUM(balance),0) s FROM users').get() as any).s;
    const bets  = (db.prepare("SELECT COALESCE(SUM(-delta),0) s FROM ledger WHERE reason LIKE 'bet:%'").get() as any).s;
    const wins  = (db.prepare("SELECT COALESCE(SUM(delta),0) s FROM ledger WHERE reason LIKE 'win:%'").get() as any).s;
    const deps  = (db.prepare("SELECT COALESCE(SUM(amount_jpy),0) s FROM deposits WHERE status='confirmed'").get() as any).s;
    const walletsCount = (db.prepare('SELECT COUNT(*) c FROM wallets WHERE enabled=1').get() as any).c;
    const embed = new EmbedBuilder().setTitle('📊 C4sino Stats').setColor(0xd4af37)
      .addFields(
        { name: 'ユーザー数', value: `${users}`, inline: true },
        { name: '流通チップ', value: `${chips.toLocaleString()}`, inline: true },
        { name: '有効ウォレット', value: `${walletsCount}`, inline: true },
        { name: '累計 BET', value: `${bets.toLocaleString()}`, inline: true },
        { name: '累計 WIN', value: `${wins.toLocaleString()}`, inline: true },
        { name: 'ハウスエッジ', value: `${(bets-wins).toLocaleString()}`, inline: true },
        { name: '入金合計 (JPY換算)', value: `¥${deps.toLocaleString()}`, inline: false },
      );
    return i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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
  if (ns === 'bj') return onBJButton(i, kind, arg);
  if (ns === 'slot') return onSlotButton(i, kind, arg);
  if (ns === 'dep') return onDepositButton(i, kind, arg);
  if (ns === 'adm') return onAdminButton(i, kind);
  if (ns === 'ov') {
    return i.reply({ embeds: [gameOverview(kind as GameKey)], flags: MessageFlags.Ephemeral });
  }
  if (ns === 'bal') {
    const bal = getBalance(i.user.id);
    return i.reply({ content: `💰 残高: **${bal.toLocaleString()} ${L('chips')}**`, flags: MessageFlags.Ephemeral });
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
    apply(st, arg as 'hit'|'stand'|'double'|'split');
    await updateBJMessage(i, entry.id, st);
  }
}

function extractSid(footer?: string | null): string | null {
  if (!footer) return null;
  const m = footer.match(/sid=([0-9a-f-]+)/);
  return m?.[1] ?? null;
}

async function startBJ(i: ButtonInteraction | ModalSubmitInteraction, bet: number) {
  assertNotBanned(i.user.id);
  ensureUser(i.user.id);
  if (bet < 10 || bet > 50000) return i.reply({ content: `${L('BET')} は 10 〜 50,000`, flags: MessageFlags.Ephemeral });
  if (getBalance(i.user.id) < bet) return i.reply({ content: '残高不足', flags: MessageFlags.Ephemeral });
  txCredit(i.user.id, -bet, 'bet:blackjack');
  const st = startHand(bet, newShoe());
  const entry = sessions.create(i.user.id, 'blackjack', st, bet);

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
  const buf = await renderBlackjack({
    player: st.player, active: st.active, dealer: st.dealer,
    hideHole: st.phase === 'player',
    bets: st.bets, balance: getBalance(i.user.id),
    phase: st.phase, results: st.results, payout: st.payout,
  });
  const file = new AttachmentBuilder(buf, { name: 'bj.png' });
  const embed = new EmbedBuilder().setImage('attachment://bj.png').setColor(0x0d5a3a).setFooter({ text: `sid=${sid}` });
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  if (st.phase === 'player') rows.push(bjActionsRow(availableActions(st)));

  await (i as any).reply({ embeds: [embed], files: [file], components: rows, flags: MessageFlags.Ephemeral });

  if (st.phase === 'done') {
    if (st.payout) txCredit(i.user.id, st.payout, 'win:blackjack', sid);
    sessions.drop(sid);
  }
}

async function updateBJMessage(i: ButtonInteraction, sid: string, st: BJState) {
  const buf = await renderBlackjack({
    player: st.player, active: st.active, dealer: st.dealer,
    hideHole: st.phase === 'player',
    bets: st.bets, balance: getBalance(i.user.id),
    phase: st.phase, results: st.results, payout: st.payout,
  });
  const file = new AttachmentBuilder(buf, { name: 'bj.png' });
  const embed = new EmbedBuilder().setImage('attachment://bj.png').setColor(0x0d5a3a).setFooter({ text: `sid=${sid}` });
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  if (st.phase === 'player') rows.push(bjActionsRow(availableActions(st)));
  await i.update({ embeds: [embed], files: [file], components: rows, attachments: [] });
  if (st.phase === 'done') {
    if (st.payout) txCredit(i.user.id, st.payout, 'win:blackjack', sid);
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

async function doSpin(i: ButtonInteraction | ModalSubmitInteraction, bet: number) {
  assertNotBanned(i.user.id);
  ensureUser(i.user.id);
  if (bet < 10 || bet > 10000) return i.reply({ content: `${L('BET')} は 10 〜 10,000`, flags: MessageFlags.Ephemeral });
  if (getBalance(i.user.id) < bet) return i.reply({ content: '残高不足', flags: MessageFlags.Ephemeral });
  txCredit(i.user.id, -bet, 'bet:slots');

  const result = spin();
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
    const win = bet * result.payoutMult;
    txCredit(i.user.id, win, 'win:slots');
  }
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

  const r = await wallets.withPaypay(w, t => pp.linkReceive(t, code, passcode));
  wallets.touchUsed(w.id);

  const stmt = db.prepare(`INSERT INTO deposits(discord_id, method, amount_jpy, amount_raw, tx_ref, status, confirmed_at)
    VALUES (?, 'paypay', ?, ?, ?, 'confirmed', strftime('%s','now'))`);
  stmt.run(discordId, r.amount, String(r.amount), code);
  txCredit(discordId, r.amount, 'deposit:paypay', code);
  return { amount: r.amount, wallet: w.label };
}

/* ────────────── MODAL ────────────── */

async function onModal(i: ModalSubmitInteraction) {
  if (i.customId === 'bj:custombet') {
    const amt = parseInt(i.fields.getTextInputValue('amt'), 10);
    if (!Number.isFinite(amt)) return i.reply({ content: '不正な数値', flags: MessageFlags.Ephemeral });
    return startBJ(i, amt);
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
      try {
        db.prepare(`INSERT INTO deposits(discord_id, method, amount_jpy, amount_raw, tx_ref, status, confirmed_at)
          VALUES (?, 'ltc', ?, ?, ?, 'confirmed', strftime('%s','now'))`)
          .run(row.discord_id, jpy, String(tx.value_ltc), tx.txid);
        txCredit(row.discord_id, jpy, 'deposit:ltc', tx.txid);
        const user = await client.users.fetch(row.discord_id).catch(() => null);
        await user?.send(`✅ LTC ${tx.value_ltc} (≈ ¥${jpy.toLocaleString()}) を受信。残高に加算しました。`).catch(() => {});
      } catch { /* dup */ }
    }
  }
}
setInterval(ltcPoll, 60_000);

/* ────────────── PayPay keepalive ────────────── */

async function paypayAlive() {
  if (!process.env.PAYPAY_SIDECAR_URL) return;
  const rows = wallets.listWallets('paypay').filter(w => w.enabled && w.access_token);
  for (const w of rows) {
    try { await wallets.withPaypay(w, t => pp.alive(t)); }
    catch (e) { console.warn(`[paypay-alive] #${w.id}:`, (e as Error).message); }
  }
}
setInterval(paypayAlive, 5 * 60_000);

client.login(process.env.DISCORD_TOKEN);
