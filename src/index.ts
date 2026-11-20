import 'dotenv/config';
import {
  Client, GatewayIntentBits, Partials, AttachmentBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, ActionRowBuilder, Events, PermissionFlagsBits,
  EmbedBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction,
  ButtonInteraction, ModalSubmitInteraction, MessageFlags,
} from 'discord.js';
import { db, getBalance, txCredit, ensureUser } from './db/schema.js';
import * as sessions from './games/session-store.js';
import { startHand, availableActions, apply, newShoe, handTotal, isBlackjack, type BJState } from './games/blackjack.js';
import { spin, reelStrip } from './games/slots.js';
import { renderBlackjack } from './ui/render-table.js';
import { renderSlots } from './ui/render-slots.js';
import { blackjackPanel, slotsPanel, depositPanel, bjActionsRow } from './ui/panels.js';
import { submitClaim, notifyAdmins, approve, reject } from './payments/paypay.js';
import { getOrCreateAddress, checkDeposits, ltcJpyRate } from './payments/ltc.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel],
});

// 設定テーブル (admin通知チャンネル)
db.exec(`CREATE TABLE IF NOT EXISTS guild_config (
  guild_id TEXT PRIMARY KEY,
  admin_channel_id TEXT
);`);

function getAdminChannel(guildId: string): string | null {
  const r = db.prepare('SELECT admin_channel_id FROM guild_config WHERE guild_id=?').get(guildId) as { admin_channel_id: string } | undefined;
  return r?.admin_channel_id ?? null;
}

client.once(Events.ClientReady, c => console.log(`[bot] online as ${c.user.tag}`));

client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isChatInputCommand()) await onCommand(i);
    else if (i.isButton()) await onButton(i);
    else if (i.isModalSubmit()) await onModal(i);
  } catch (e) {
    console.error(e);
    const msg = `❌ error: ${(e as Error).message}`;
    if (i.isRepliable()) {
      if (i.replied || i.deferred) await i.followUp({ content: msg, flags: MessageFlags.Ephemeral });
      else await i.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  }
});

async function onCommand(i: ChatInputCommandInteraction) {
  if (i.commandName === 'setup') {
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
  } else if (i.commandName === 'balance') {
    const bal = getBalance(i.user.id);
    await i.reply({ content: `💰 残高: **${bal.toLocaleString()} chips**`, flags: MessageFlags.Ephemeral });
  } else if (i.commandName === 'admin-channel') {
    if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator))
      return i.reply({ content: '管理者のみ', flags: MessageFlags.Ephemeral });
    db.prepare(`INSERT INTO guild_config(guild_id, admin_channel_id) VALUES (?,?)
      ON CONFLICT(guild_id) DO UPDATE SET admin_channel_id=excluded.admin_channel_id`)
      .run(i.guildId!, i.channelId);
    await i.reply({ content: '✅ 承認通知チャンネル登録', flags: MessageFlags.Ephemeral });
  }
}

async function onButton(i: ButtonInteraction) {
  const [ns, kind, arg] = i.customId.split(':');
  if (ns === 'bj') return onBJButton(i, kind, arg);
  if (ns === 'slot') return onSlotButton(i, kind, arg);
  if (ns === 'dep') return onDepositButton(i, kind, arg);
  if (ns === 'bal') {
    const bal = getBalance(i.user.id);
    return i.reply({ content: `💰 残高: **${bal.toLocaleString()} chips**`, flags: MessageFlags.Ephemeral });
  }
}

/* ────────────── BLACKJACK ────────────── */

async function onBJButton(i: ButtonInteraction, kind: string, arg: string) {
  if (kind === 'bet') {
    if (arg === 'custom') {
      const modal = new ModalBuilder().setCustomId('bj:custombet').setTitle('Blackjack — Custom Bet')
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('amt').setLabel('BET (chips)').setStyle(TextInputStyle.Short).setRequired(true)
        ));
      return i.showModal(modal);
    }
    return startBJ(i, parseInt(arg, 10));
  }
  if (kind === 'act') {
    // sid はメッセージのフッターまたは customId には収まらないので、sessionIdをembed descに埋めている
    const sid = extractSid(i.message.embeds[0]?.footer?.text);
    if (!sid) return i.reply({ content: 'セッションが見つかりません', flags: MessageFlags.Ephemeral });
    const entry = sessions.get(sid);
    if (!entry || entry.discordId !== i.user.id) return i.reply({ content: 'このセッションは他のユーザーのものです', flags: MessageFlags.Ephemeral });
    const st = entry.state as BJState;
    apply(st, arg as 'hit'|'stand'|'double'|'split');
    // ダブル時に追加の掛け金を引く
    // (bets は apply 内で2倍されているので差分だけ引く)
    // 実装簡略のため: ここでは split/double は start時にチェック → double成立時は追加で bet 分を即減算
    await updateBJMessage(i, entry.id, st, false);
  }
}

function extractSid(footer?: string | null): string | null {
  if (!footer) return null;
  const m = footer.match(/sid=([0-9a-f-]+)/);
  return m?.[1] ?? null;
}

async function startBJ(i: ButtonInteraction, bet: number) {
  ensureUser(i.user.id);
  if (bet < 10 || bet > 50000) return i.reply({ content: 'ベットは 10 〜 50,000', flags: MessageFlags.Ephemeral });
  if (getBalance(i.user.id) < bet) return i.reply({ content: '残高不足', flags: MessageFlags.Ephemeral });
  txCredit(i.user.id, -bet, 'bet:blackjack');
  const st = startHand(bet, newShoe());
  const entry = sessions.create(i.user.id, 'blackjack', st, bet);

  // BJ 即勝利/ディーラーBJチェック
  if (isBlackjack(st.player[0]) || isBlackjack(st.dealer)) {
    // 両方 BJ の可能性含めて settle
    st.phase = 'dealer';
    // dealer flow を使うために apply('stand')
    (st as any).active = st.player.length;
    // 直接 settle
    const dealerBJ = isBlackjack(st.dealer);
    const playerBJ = isBlackjack(st.player[0]);
    if (playerBJ && dealerBJ) { st.results = ['push']; st.payout = bet; }
    else if (playerBJ) { st.results = ['bj']; st.payout = Math.floor(bet * 2.5); }
    else { st.results = ['lose']; st.payout = 0; }
    st.phase = 'done';
  }

  await sendBJEphemeral(i, entry.id, st);
}

async function sendBJEphemeral(i: ButtonInteraction, sid: string, st: BJState) {
  const buf = await renderBlackjack({
    player: st.player, active: st.active, dealer: st.dealer,
    hideHole: st.phase === 'player',
    bets: st.bets, balance: getBalance(i.user.id),
    phase: st.phase, results: st.results, payout: st.payout,
  });
  const file = new AttachmentBuilder(buf, { name: 'bj.png' });
  const embed = new EmbedBuilder()
    .setImage('attachment://bj.png')
    .setColor(0x0d5a3a)
    .setFooter({ text: `sid=${sid}` });

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  if (st.phase === 'player') rows.push(bjActionsRow(availableActions(st)));

  await i.reply({ embeds: [embed], files: [file], components: rows, flags: MessageFlags.Ephemeral });

  if (st.phase === 'done') {
    if (st.payout) txCredit(i.user.id, st.payout, 'win:blackjack', sid);
    sessions.drop(sid);
  }
}

async function updateBJMessage(i: ButtonInteraction, sid: string, st: BJState, newReply: boolean) {
  const buf = await renderBlackjack({
    player: st.player, active: st.active, dealer: st.dealer,
    hideHole: st.phase === 'player',
    bets: st.bets, balance: getBalance(i.user.id),
    phase: st.phase, results: st.results, payout: st.payout,
  });
  const file = new AttachmentBuilder(buf, { name: 'bj.png' });
  const embed = new EmbedBuilder()
    .setImage('attachment://bj.png').setColor(0x0d5a3a).setFooter({ text: `sid=${sid}` });
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
  if (arg === 'custom') {
    const modal = new ModalBuilder().setCustomId('slot:custombet').setTitle('Slots — Custom Bet')
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('amt').setLabel('BET (chips)').setStyle(TextInputStyle.Short).setRequired(true)
      ));
    return i.showModal(modal);
  }
  await doSpin(i, parseInt(arg, 10));
}

async function doSpin(i: ButtonInteraction | ModalSubmitInteraction, bet: number) {
  ensureUser(i.user.id);
  if (bet < 10 || bet > 10000) return i.reply({ content: 'ベットは 10 〜 10,000', flags: MessageFlags.Ephemeral });
  if (getBalance(i.user.id) < bet) return i.reply({ content: '残高不足', flags: MessageFlags.Ephemeral });
  txCredit(i.user.id, -bet, 'bet:slots');

  const result = spin();
  const stripA = reelStrip(result.reels[0], 8);
  const stripB = reelStrip(result.reels[1], 10);
  const stripC = reelStrip(result.reels[2], 12);

  // 最初のスピン画面
  const first = await renderSlots({
    reels: [stripA[0], stripB[0], stripC[0]],
    above: [stripA[1] ?? stripA[0], stripB[1] ?? stripB[0], stripC[1] ?? stripC[0]],
    below: [stripA[2] ?? stripA[0], stripB[2] ?? stripB[0], stripC[2] ?? stripC[0]],
    bet, balance: getBalance(i.user.id), payoutMult: 0, spinning: true,
  });
  const msg = await i.reply({
    files: [new AttachmentBuilder(first, { name: 's.png' })],
    flags: MessageFlags.Ephemeral, fetchReply: true,
  });

  // アニメ (3フレーム) — 各リール停止タイミングをずらす
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
      label: !spinning && result.payoutMult >= 100 ? (result.payoutMult >= 1000 ? 'JACKPOT' : 'BIG WIN') : 'WIN',
    });
    await i.editReply({ files: [new AttachmentBuilder(buf, { name: 's.png' })] });
  }

  if (result.payoutMult > 0) {
    const win = bet * result.payoutMult;
    txCredit(i.user.id, win, 'win:slots');
  }
}

/* ────────────── CASHIER ────────────── */

async function onDepositButton(i: ButtonInteraction, kind: string, arg: string) {
  if (kind === 'paypay') {
    const modal = new ModalBuilder().setCustomId('dep:paypay').setTitle('PayPay 送金リンク提出')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('amt').setLabel('送金額 (JPY)').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('url').setLabel('送金リンク URL').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('pin').setLabel('パスコード (任意)').setStyle(TextInputStyle.Short).setRequired(false)),
      );
    return i.showModal(modal);
  }
  if (kind === 'ltc') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const addr = await getOrCreateAddress(i.user.id);
    const rate = await ltcJpyRate().catch(() => null);
    const embed = new EmbedBuilder()
      .setTitle('LTC 入金')
      .setDescription('下記アドレスに LTC を送金してください。1承認で自動チャージされます。')
      .addFields(
        { name: 'アドレス', value: `\`${addr}\`` },
        ...(rate ? [{ name: '現在レート', value: `1 LTC ≈ ¥${rate.toLocaleString()}` }] : []),
      )
      .setColor(0x345d9d);
    return i.editReply({ embeds: [embed] });
  }
  if (kind === 'approve' || kind === 'reject') {
    const adminCh = getAdminChannel(i.guildId!);
    if (!adminCh || adminCh !== i.channelId)
      return i.reply({ content: '承認は管理チャンネルで', flags: MessageFlags.Ephemeral });
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
      return i.reply({ content: '権限不足', flags: MessageFlags.Ephemeral });
    const id = parseInt(arg, 10);
    if (kind === 'approve') {
      const dep = approve(id);
      await i.update({ components: [], embeds: [EmbedBuilder.from(i.message.embeds[0]).setColor(0x22c55e).setTitle('✅ 承認済み')] });
      const user = await client.users.fetch(dep.discord_id).catch(() => null);
      await user?.send(`✅ PayPay ¥${dep.amount_jpy.toLocaleString()} を承認。残高に加算しました。`).catch(() => {});
    } else {
      reject(id);
      await i.update({ components: [], embeds: [EmbedBuilder.from(i.message.embeds[0]).setColor(0xef4444).setTitle('❌ 却下')] });
    }
  }
}

async function onModal(i: ModalSubmitInteraction) {
  if (i.customId === 'bj:custombet') {
    const amt = parseInt(i.fields.getTextInputValue('amt'), 10);
    if (!Number.isFinite(amt)) return i.reply({ content: '不正な数値', flags: MessageFlags.Ephemeral });
    return startBJ(i as unknown as ButtonInteraction, amt);
  }
  if (i.customId === 'slot:custombet') {
    const amt = parseInt(i.fields.getTextInputValue('amt'), 10);
    if (!Number.isFinite(amt)) return i.reply({ content: '不正な数値', flags: MessageFlags.Ephemeral });
    return doSpin(i, amt);
  }
  if (i.customId === 'dep:paypay') {
    const amt = parseInt(i.fields.getTextInputValue('amt'), 10);
    const url = i.fields.getTextInputValue('url').trim();
    const pin = i.fields.getTextInputValue('pin').trim() || undefined;
    if (!Number.isFinite(amt) || amt <= 0) return i.reply({ content: '金額が不正', flags: MessageFlags.Ephemeral });
    if (!/^https:\/\/(pay\.)?paypay\.ne\.jp\//.test(url)) return i.reply({ content: 'PayPay 送金リンクではありません', flags: MessageFlags.Ephemeral });
    const depId = submitClaim({ discordId: i.user.id, amountJpy: amt, linkUrl: url, passcode: pin });
    const adminCh = getAdminChannel(i.guildId!);
    if (adminCh) await notifyAdmins(client, adminCh, depId, { discordId: i.user.id, amountJpy: amt, linkUrl: url, passcode: pin });
    await i.reply({ content: `✅ 承認待ち (#${depId}) — 管理者の確認をお待ちください`, flags: MessageFlags.Ephemeral });
  }
}

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
      const stmt = db.prepare(`INSERT INTO deposits(discord_id, method, amount_jpy, amount_raw, tx_ref, status, confirmed_at)
        VALUES (?, 'ltc', ?, ?, ?, 'confirmed', strftime('%s','now'))`);
      try {
        stmt.run(row.discord_id, jpy, String(tx.value_ltc), tx.txid);
        txCredit(row.discord_id, jpy, 'deposit:ltc', tx.txid);
        const user = await client.users.fetch(row.discord_id).catch(() => null);
        await user?.send(`✅ LTC ${tx.value_ltc} (≈ ¥${jpy.toLocaleString()}) を受信。残高に加算しました。`).catch(() => {});
      } catch { /* dup */ }
    }
  }
}

setInterval(ltcPoll, 60_000);

client.login(process.env.DISCORD_TOKEN);
