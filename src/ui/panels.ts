import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { L } from './leet.js';
import { formatRemaining, elapsedRatio, EXTENSION_PERIOD_SEC, type MwsState } from '../mws/timer.js';
import type { Game } from '../tables.js';
import { emojiRef } from './emoji-ids.js';
import { gamePanelEmbed, cashierEmbed } from './overview.js';
import { COLOR, ICON } from './theme.js';
import { emojiGauge } from './balance-gauge.js';







/**
 * リザルト画面 / 入金完了画面の [Replay] [入金] ボタン。
 * sub は前回の賭け方 (バカラのサイド、ルーレットの掛け方)。
 * どのゲームに戻るか (ctx = <game>[:<sub>]) を両方のボタンに埋め込んで持ち回る。
 */
export function replayRow(game: string, sub?: string): ActionRowBuilder<ButtonBuilder> {
  const ctx = `${game}${sub ? `:${sub}` : ''}`;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    btn(`replay:${ctx}`, 'Replay', ButtonStyle.Primary),
    btn(`dep:open:${ctx}`, '入金', ButtonStyle.Secondary, 'ui_wallet'),
  );
}

/** replayRow を ctx (<game>[:<sub>]) から作る。 */
export function replayRowFromCtx(ctx: string): ActionRowBuilder<ButtonBuilder> {
  const [game, ...rest] = ctx.split(':');
  return replayRow(game, rest.join(':') || undefined);
}




export function leetPanel() {
  const embed = new EmbedBuilder()
    .setTitle('LEET 変換')
    .setColor(0x6b7280)
    .setDescription(
      '入力したアルファベットをオリジナル LEET に変換します。\n' +
      '結果は投稿者本人にのみ表示されます (ephemeral)。'
    )
    .setFooter({ text: '管理者用ツール' });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('leet:convert').setLabel('変換').setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [row] };
}

/* ────────────── Per-game Play panels (mix bet 対応) ────────────── */

const GAME_EMOJI: Record<Game, string> = {
  blackjack: 'game_blackjack', slots: 'game_slots', roulette: 'game_roulette',
  baccarat: 'game_baccarat', videopoker: 'game_videopoker', craps: 'game_craps',
};

/** ボタン。登録済みのアプリ絵文字があれば付ける。 */
function btn(customId: string, label: string, style: ButtonStyle, emojiName?: string): ButtonBuilder {
  const b = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
  const ref = emojiName ? emojiRef(emojiName) : null;
  if (ref) b.setEmoji(ref);
  return b;
}

/** チャンネルに置くゲームのパネル。全ゲーム共通で [PLAY] [入金] [残高]。 */
export function publicGamePanel(game: Game) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    btn(`play:${game}`, 'PLAY', ButtonStyle.Primary, GAME_EMOJI[game]),
    btn(`dep:open:${game}`, '入金', ButtonStyle.Secondary, 'ui_wallet'),
    btn('bal', '残高', ButtonStyle.Secondary, 'ui_balance'),
  );
  return { embeds: [gamePanelEmbed(game)], components: [row] };
}

/**
 * 残高カード。各パネルの [残高] ボタンで使う。
 * 合計と、PayPay 由来 / LTC 由来の割合を絵文字のゲージで出す。
 */
export async function balanceReply(pp: number, ltc: number, note?: string) {
  const total = pp + ltc;
  const share = (n: number) => (total > 0 ? ` (${((n / total) * 100).toFixed(1)}%)` : '');
  const lines = [
    `### ${ICON.balance()} 残高`,
    `# ¥${total.toLocaleString()}`,
    emojiGauge(pp, ltc),
    `${ICON.paypay()} PayPay 由来  **¥${pp.toLocaleString()}**${share(pp)}`,
    `${ICON.ltc()} LTC 由来  **¥${ltc.toLocaleString()}**${share(ltc)}`,
  ];
  if (note) lines.push('', note);
  const embed = new EmbedBuilder()
    .setColor(COLOR.violet)
    .setDescription(lines.join('\n'))
    .setFooter({ text: '出金は、入金した方法の分まで (PayPay で入れた分は PayPay で)' });
  return { embeds: [embed], files: [] };
}

export function depositPanel() {
  // 入金 / 出金を押すと、本人だけに見える支払い方法の選択が出る (2 段階)。
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    btn('dep:open', '入金', ButtonStyle.Secondary, 'ui_wallet'),
    btn('wd:open', '出金', ButtonStyle.Secondary, 'ui_chip'),
    btn('bal', '残高', ButtonStyle.Secondary, 'ui_balance'),
  );
  return { embeds: [cashierEmbed()], components: [row] };
}
export function depositMethodPicker(ctx = '') {
  // ctx があればゲームのリザルト画面から来た入金。完了画面で同じゲームに Replay できるよう持ち回る。
  const suffix = ctx ? `:${ctx}` : '';
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    btn(`dep:paypay${suffix}`, 'PayPay', ButtonStyle.Secondary, 'pay_paypay'),
    btn(`dep:ltc${suffix}`, 'LTC', ButtonStyle.Secondary, 'pay_ltc'),
  );
  return { content: `${ICON.wallet()} 入金方法を選んでください`, components: [row] };
}

/** 「出金」ボタンから開く支払い方法選択 (ephemeral)。 */
export function withdrawMethodPicker() {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    btn('wd:paypay', 'PayPay', ButtonStyle.Secondary, 'pay_paypay'),
    btn('wd:ltc', 'LTC', ButtonStyle.Secondary, 'pay_ltc'),
  );
  return { content: `${ICON.chip()} 出金方法を選んでください`, components: [row] };
}

export function bjActionsRow(actions: string[], sid?: string): ActionRowBuilder<ButtonBuilder> {
  const map: Record<string, { label: string; style: ButtonStyle }> = {
    hit:   { label: L('HIT'),    style: ButtonStyle.Primary },
    stand: { label: L('STAND'),  style: ButtonStyle.Secondary },
    double:{ label: L('DOUBLE'), style: ButtonStyle.Secondary },
    split: { label: L('SPLIT'),  style: ButtonStyle.Secondary },
  };
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const a of actions) {
    const m = map[a];
    row.addComponents(new ButtonBuilder().setCustomId(sid ? `bj:act:${a}:${sid}` : `bj:act:${a}`).setLabel(m.label).setStyle(m.style));
  }
  return row;
}

/* ────────────── MWS (cloud.m-ws.cc) 7 日延長タイマー ────────────── */

const MWS_BAR_WIDTH = 24;

function mwsBar(state: MwsState): string {
  const r = elapsedRatio(state);
  const filled = Math.round(MWS_BAR_WIDTH * r);
  return '█'.repeat(filled) + '░'.repeat(MWS_BAR_WIDTH - filled);
}

function mwsStatusColor(remainingSec: number): number {
  if (remainingSec <= 0)          return 0x991b1b; // 期限切れ: 暗赤
  if (remainingSec <= 3600)       return 0xdc2626; // 残り 1h 以下: 赤
  if (remainingSec <= 6 * 3600)   return 0xf59e0b; // 残り 6h 以下: 橙
  if (remainingSec <= 24 * 3600)  return 0xeab308; // 残り 24h 以下: 黄
  return 0x10b981;                                 // 余裕: 緑
}

/**
 * MWS 7 日タイマーパネル。
 * 現在の残り時間・最終延長時刻・通知設定を表示し、
 * - 延長完了ボタン (タイマーリセット、管理者のみ)
 * - 通知設定ボタン (このチャンネル・ロール指定、管理者のみ)
 * - 更新ボタン (誰でも)
 * を配置する。
 */
export function mwsPanel(state: MwsState) {
  const bar = mwsBar(state);
  const extendedAt = `<t:${state.lastExtendedAt}:f>`;
  const expiresAt  = `<t:${state.expiresAt}:f> (<t:${state.expiresAt}:R>)`;
  const remaining  = formatRemaining(state.remainingSec);
  const notify = state.notifyChannelId
    ? `<#${state.notifyChannelId}>` + (state.notifyRoleId ? ` (<@&${state.notifyRoleId}> を mention)` : '')
    : '_未設定_';

  const embed = new EmbedBuilder()
    .setTitle('MWS Keep-Alive  —  cloud.m-ws.cc')
    .setDescription(
      [
        '```',
        `[${bar}]`,
        '```',
        remaining,
        '',
        '**使い方**',
        '1. MWS ダッシュボードで「延長」ボタンを押す',
        '2. このパネルの **延長完了** ボタンを押してタイマーをリセット',
        '3. 残り **24h / 6h / 1h** になったら通知チャンネルに警告が飛ぶ',
        '',
        '_自動延長は MWS 利用規約違反のため、Bot 側では残時間通知のみを行います。_',
      ].join('\n')
    )
    .addFields(
      { name: '最終延長',       value: extendedAt,                             inline: true },
      { name: '次回期限',       value: expiresAt,                              inline: true },
      { name: '通知先',         value: notify,                                 inline: false },
    )
    .setColor(mwsStatusColor(state.remainingSec))
    .setFooter({ text: `MWS keep-alive · 7日 ごとに手動延長が必要` });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('mws:extended').setLabel('延長完了 (タイマーリセット)').setStyle(ButtonStyle.Success).setEmoji('🔁'),
    new ButtonBuilder().setCustomId('mws:notify_here').setLabel('通知先をこのチャンネルに').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('mws:notify_clear').setLabel('通知先を解除').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mws:refresh').setLabel('更新').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

/**
 * 通知チャンネルに流す警告メッセージ (24h / 6h / 1h / expired)。
 */
export function mwsWarningText(bucket: 24 | 6 | 1 | 'expired', state: MwsState, roleMention: string | null): string {
  const prefix = roleMention ? `${roleMention} ` : '';
  if (bucket === 'expired') {
    return `${prefix}:red_circle:  **MWS Bot の稼働が停止しました。**\ncloud.m-ws.cc ダッシュボードで直ちに「延長」ボタンを押し、起動後にパネルの **延長完了** を押してください。`;
  }
  const emoji = bucket === 24 ? ':yellow_circle:' : bucket === 6 ? ':orange_circle:' : ':red_circle:';
  const label = bucket === 24 ? '残り 24 時間' : bucket === 6 ? '残り 6 時間' : '残り 1 時間';
  return [
    `${prefix}${emoji}  **MWS keep-alive: ${label}**`,
    `次回期限: <t:${state.expiresAt}:f> (<t:${state.expiresAt}:R>)`,
    '',
    'cloud.m-ws.cc のダッシュボードで「延長」ボタンを押し、その後パネルの **延長完了** を押してください。',
  ].join('\n');
}

