/**
 * 管理パネルの見た目。/admin panel でチャンネルに置く入口 (ハブ) と、ボタンで開く各画面。
 * 各画面は押した本人だけに見え、画面の中で次へ進む。処理は index.ts の onAdminPanel。
 *
 *   ハブ ─ [ゲームパネル] 設置済み一覧 → 種類を選ぶ → チャンネルを選ぶ → 設置 / 全パネル再設置
 *        ─ [ウォレット]   登録状況 → PayPay 登録 / LTC 登録 / 有効・無効 / 削除 / 残高 / 利益引き出し
 *        ─ [サーバー管理] NG ワード / ユーザー / 運営データ
 *        ─ [LEET]         変換の入力画面
 */
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, ModalBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
} from 'discord.js';
import { emoji, emojiRef } from './emoji-ids.js';
import { COLOR, ICON, panelEmbed, type Section } from './theme.js';

/** 設置できるパネル。key は panels テーブルの game 列に入る値。 */
export const PANEL_KINDS: Array<{ key: string; label: string; emoji: string; group: string }> = [
  { key: 'blackjack',  label: 'ブラックジャック',       emoji: 'game_blackjack',  group: 'ゲーム' },
  { key: 'slots',      label: 'スロット',               emoji: 'game_slots',      group: 'ゲーム' },
  { key: 'roulette',   label: 'ルーレット',             emoji: 'game_roulette',   group: 'ゲーム' },
  { key: 'baccarat',   label: 'バカラ',                 emoji: 'game_baccarat',   group: 'ゲーム' },
  { key: 'videopoker', label: 'ビデオポーカー',         emoji: 'game_videopoker', group: 'ゲーム' },
  { key: 'craps',      label: 'クラップス',             emoji: 'game_craps',      group: 'ゲーム' },
  { key: 'mines',      label: 'マインスイーパー',       emoji: 'game_mines',      group: 'ゲーム' },
  { key: 'cashier',    label: '入出金 (Cashier)',       emoji: 'ui_wallet',       group: '入出金' },
  { key: 'overview:all',        label: 'ルール: 全ゲーム概要',     emoji: 'ui_crown',        group: 'ルール説明' },
  { key: 'overview:cashier',    label: 'ルール: 入出金',           emoji: 'ui_wallet',       group: 'ルール説明' },
];
/** 以前は設置できたパネル。ゲームごとのルールは全ゲーム概要とゲームのパネルにある。MWS・LEET は /mws・/leet コマンドで使う。設置済みのものは一覧と再設置で扱う。 */
const LEGACY_KINDS = [
  { key: 'overview:blackjack', label: 'ルール: ブラックジャック (旧)', emoji: 'game_blackjack' },
  { key: 'overview:slots', label: 'ルール: スロット (旧)', emoji: 'game_slots' },
  { key: 'overview:roulette', label: 'ルール: ルーレット (旧)', emoji: 'game_roulette' },
  { key: 'overview:baccarat', label: 'ルール: バカラ (旧)', emoji: 'game_baccarat' },
  { key: 'overview:videopoker', label: 'ルール: ビデオポーカー (旧)', emoji: 'game_videopoker' },
  { key: 'overview:craps', label: 'ルール: クラップス (旧)', emoji: 'game_craps' },
  { key: 'mws',  label: 'MWS 延長タイマー (旧)', emoji: 'adm_server' },
  { key: 'leet', label: 'LEET 変換 (旧)',        emoji: 'adm_leet' },
];
export const isLegacyPanelKey = (key: string) => LEGACY_KINDS.some(k => k.key === key);
/** 管理パネル。ゲーム管理パネルの対象外で、/admin panel でだけ設置する。 */
export const ADMIN_PANEL_KINDS = [
  { key: 'admin:games',  label: 'ゲーム管理パネル' },
  { key: 'admin:wallet', label: 'ウォレット管理パネル' },
  { key: 'admin:server', label: 'サーバー管理パネル' },
];
export const isAdminPanelKey = (key: string) => key === 'admin' || key.startsWith('admin:');
export const panelLabel = (key: string) =>
  [...PANEL_KINDS, ...LEGACY_KINDS, ...ADMIN_PANEL_KINDS].find(k => k.key === key)?.label ?? key;
/** 管理パネル専用の絵文字。ユーザー向けの画面と混同しないよう、別の絵柄を使う。 */
const ADM = {
  badge:  () => emoji('adm_badge') || '◆',
  panel:  () => emoji('adm_panel'),
  wallet: () => emoji('adm_wallet'),
  server: () => emoji('adm_server'),
  ng:     () => emoji('adm_ng'),
  user:   () => emoji('adm_user'),
  ban:    () => emoji('adm_ban'),
  chart:  () => emoji('adm_chart'),
  check:  () => emoji('adm_check') || '✓',
  leet:   () => emoji('adm_leet'),
  bullet: () => emoji('adm_bullet') || '◇',
};

/** 設置済み一覧で各パネルの前に出す絵文字 (箇条書きの矢印とは別のもの) */
const panelIcon = (key: string) => emoji([...PANEL_KINDS, ...LEGACY_KINDS].find(x => x.key === key)?.emoji ?? '') || '•';

/* ────────────── 部品 ────────────── */

function btn(id: string, label: string, style = ButtonStyle.Secondary, emojiName?: string, disabled = false): ButtonBuilder {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
  const ref = emojiName ? emojiRef(emojiName) : null;
  if (ref) b.setEmoji(ref);
  return b;
}
const row = (...b: ButtonBuilder[]) => new ActionRowBuilder<ButtonBuilder>().addComponents(...b);
const backRow = (to = 'home', label = '戻る') => row(btn(`ap:open:${to}`, label, ButtonStyle.Secondary));

/** 各画面の共通の形。操作の結果 (notice) があれば一番上に出す。 */
function screen(title: string, tagline: string, sections: Section[], notice?: Notice, icon = ADM.badge()) {
  if (notice) {
    sections = [{ icon: notice.ok ? ADM.check() : ADM.badge(), title: notice.ok ? '完了' : '確認してください', lines: [notice.text] }, ...sections];
  }
  return panelEmbed({ icon, title, tagline, sections, color: COLOR.violet, footer: 'C4sino · 管理パネル', bullet: ADM.bullet(), deco: '' });
}

export type Notice = { ok: boolean; text: string } | undefined;

/* ────────────── ハブ ────────────── */

export function adminHub() {
  const embed = panelEmbed({
    icon: ADM.badge(), title: '管理パネル', tagline: 'サーバー管理権限のある人だけが操作できます', color: COLOR.violet,
    footer: 'C4sino · 管理パネル', bullet: ADM.bullet(), deco: '',
    sections: [
      { icon: ADM.panel(), title: 'ゲーム管理パネル', lines: ['ゲーム・入出金・ルール説明などのパネルを設置', 'チャンネルを選んで設置 / 全パネルを置き直し'] },
      { icon: ADM.wallet(), title: 'ウォレット管理パネル', lines: ['運営の PayPay・LTC ウォレットの登録と確認', '有効・無効の切り替え、残高確認、利益の引き出し'] },
      { icon: ADM.server(), title: 'サーバー管理パネル', lines: ['NG ワードの一覧・追加・削除', 'ユーザーの情報・履歴・chip 付与・BAN', '統計・出金の保留・当選告知の設定'] },
      { icon: ADM.leet(), title: 'LEET', lines: ['文字列を LEET 表記に変換'] },
    ],
  });
  return {
    embeds: [embed],
    components: [row(
      btn('ap:open:games', 'ゲーム管理パネル', ButtonStyle.Secondary, 'adm_panel'),
      btn('ap:open:wallet', 'ウォレット管理パネル', ButtonStyle.Secondary, 'adm_wallet'),
      btn('ap:open:server', 'サーバー管理パネル', ButtonStyle.Secondary, 'adm_server'),
      btn('ap:open:leet', 'LEET', ButtonStyle.Secondary, 'adm_leet'),
    )],
  };
}

/* ────────────── チャンネルに常設する管理パネル (/admin panel) ────────────── */
// 選択欄は置かない (選んだ値が他の管理者の画面にも残るため)。ボタンで本人だけの作業画面を開く。

export function gamesLanding(installed: InstalledPanel[]) {
  const lines = installed.length
    ? installed.map(p => `${panelIcon(p.game)} ${panelLabel(p.game)} — <#${p.channel_id}>`)
    : ['_まだ設置されていません_'];
  const embed = screen('ゲーム管理パネル', 'ゲーム・入出金・ルール説明などのパネルを設置', [
    { icon: ADM.panel(), title: `設置済み (${installed.length})`, lines },
    { icon: ADM.bullet(), title: '使い方', lines: [
      '「パネルを設置する」: 種類とチャンネルを選んで設置',
      '「全パネルを再設置」: 設置済みを全部消して置き直す',
      '「一覧を更新」: 上の一覧を最新にする',
    ] },
  ], undefined, ADM.panel());
  return { embeds: [embed], components: [row(
    btn('ap:open:games', 'パネルを設置する', ButtonStyle.Secondary, 'adm_panel'),
    btn('ap:games:reinstall', '全パネルを再設置', ButtonStyle.Secondary, undefined, installed.length === 0),
    btn('ap:land:games', '一覧を更新'),
  )] };
}

export function walletLanding(rows: WalletRow[]) {
  const embed = walletScreen(rows, undefined).embeds[0];
  return { embeds: [embed], components: [row(
    btn('ap:open:wallet', 'ウォレットを操作する', ButtonStyle.Secondary, 'adm_wallet'),
    btn('ap:wallet:addpp', 'PayPay を登録', ButtonStyle.Secondary, 'pay_paypay'),
    btn('ap:wallet:addltc', 'LTC を登録', ButtonStyle.Secondary, 'pay_ltc'),
    btn('ap:land:wallet', '一覧を更新'),
  )] };
}

export function serverLanding() {
  return serverHome();
}

/* ────────────── ① ゲームパネル ────────────── */

export interface InstalledPanel { channel_id: string; message_id: string; game: string }

export function gamesScreen(installed: InstalledPanel[], sel: { kind?: string; channelId?: string }, notice?: Notice) {
  const lines = installed.length
    ? installed.map(p => `${panelIcon(p.game)} ${panelLabel(p.game)} — <#${p.channel_id}>`)
    : ['_まだ設置されていません_'];
  const embed = screen('ゲーム管理パネル', '種類とチャンネルを選んで「設置」', [
    { icon: ADM.panel(), title: `設置済み (${installed.length})`, lines },
    { icon: ADM.bullet(), title: '使い方', lines: [
      '① 設置するパネルの種類を選ぶ',
      '② 設置先のチャンネルを選ぶ',
      '③ 「設置」。同じチャンネルに同じパネルがあれば置き直す',
      '「全パネルを再設置」で、設置済みを全部消して置き直す',
    ] },
  ], notice, ADM.panel());
  const kind = new StringSelectMenuBuilder().setCustomId('ap:games:kind').setPlaceholder('① 設置するパネルの種類')
    .addOptions(PANEL_KINDS.map(k => {
      const o = new StringSelectMenuOptionBuilder().setValue(k.key).setLabel(k.label).setDescription(k.group).setDefault(k.key === sel.kind);
      const ref = emojiRef(k.emoji);
      if (ref) o.setEmoji(ref);
      return o;
    }));
  const ch = new ChannelSelectMenuBuilder().setCustomId('ap:games:channel').setPlaceholder('② 設置先のチャンネル')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  if (sel.channelId) ch.setDefaultChannels(sel.channelId);
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(kind),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(ch),
      row(
        btn('ap:games:install', '③ 設置', ButtonStyle.Primary, 'adm_check', !(sel.kind && sel.channelId)),
        btn('ap:games:reinstall', '全パネルを再設置', ButtonStyle.Secondary, undefined, installed.length === 0),
        btn('ap:open:games', '表示を更新'),
      ),
    ],
  };
}

export function confirmScreen(title: string, lines: string[], yesId: string, noId: string) {
  const embed = screen(title, 'この操作は取り消せません', [{ icon: ADM.badge(), title: '実行する内容', lines }]);
  return { embeds: [embed], components: [row(btn(yesId, '実行する', ButtonStyle.Danger), btn(noId, 'キャンセル'))] };
}

/* ────────────── ② ウォレット ────────────── */

export interface WalletRow {
  id: number; kind: 'paypay' | 'ltc'; label: string; enabled: number | boolean;
  display_name?: string | null; balance_cached?: number | null; address?: string | null; access_token?: string | null;
  derivation?: string | null;
}

export function walletScreen(rows: WalletRow[], selectedId: number | undefined, notice?: Notice) {
  const pp = rows.filter(w => w.kind === 'paypay');
  const ltc = rows.filter(w => w.kind === 'ltc');
  const state = (w: WalletRow) => (w.enabled ? '有効' : '**無効**');
  const sections: Section[] = [
    { icon: ICON.paypay(), title: `PayPay (${pp.length})`, lines: pp.length ? pp.map(w =>
      `#${w.id} ${w.label} — ${state(w)} / ${w.access_token ? `残高 ¥${(w.balance_cached ?? 0).toLocaleString()} (前回の確認時)` : '未ログイン'}${w.display_name ? ` / ${w.display_name}` : ''}`) : ['_未登録_'] },
    { icon: ICON.ltc(), title: `LTC (${ltc.length})`, lines: ltc.length ? ltc.map(w =>
      `#${w.id} ${w.label} — ${state(w)} / ${w.derivation ? '自動送金あり' : '受け取り専用'} / \`${w.address}\``) : ['_未登録_'] },
    { icon: ADM.bullet(), title: '使い方', lines: [
      '登録: 「PayPay を登録」「LTC を登録」',
      '切り替え・削除・残高確認: ウォレットを選んでから押す',
      '利益の引き出し: PayPay ウォレットを選んで押す (選ばなければ残高の多いもの)',
    ] },
  ];
  const embed = screen('ウォレット管理パネル', '運営が入出金に使うウォレット', sections, notice, ADM.wallet());
  const comps: ActionRowBuilder<any>[] = [];
  if (rows.length) {
    comps.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId('ap:wallet:pick').setPlaceholder('操作するウォレットを選ぶ')
        .addOptions(rows.slice(0, 25).map(w => {
          const o = new StringSelectMenuOptionBuilder().setValue(String(w.id))
            .setLabel(`#${w.id} ${w.label}`.slice(0, 100)).setDescription(`${w.kind === 'paypay' ? 'PayPay' : 'LTC'} / ${w.enabled ? '有効' : '無効'}`)
            .setDefault(w.id === selectedId);
          const ref = emojiRef(w.kind === 'paypay' ? 'pay_paypay' : 'pay_ltc');
          if (ref) o.setEmoji(ref);
          return o;
        }))));
  }
  const sel = rows.find(w => w.id === selectedId);
  comps.push(row(
    btn('ap:wallet:enable', '有効にする', ButtonStyle.Secondary, undefined, !sel || !!sel.enabled),
    btn('ap:wallet:disable', '無効にする', ButtonStyle.Secondary, undefined, !sel || !sel.enabled),
    btn('ap:wallet:balance', '残高を確認', ButtonStyle.Secondary, 'adm_chart', !sel || sel.kind !== 'paypay'),
    btn('ap:wallet:remove', '削除', ButtonStyle.Danger, undefined, !sel),
  ));
  comps.push(row(
    btn('ap:wallet:addpp', 'PayPay を登録', ButtonStyle.Primary, 'pay_paypay'),
    btn('ap:wallet:addltc', 'LTC を登録', ButtonStyle.Primary, 'pay_ltc'),
    btn('ap:wallet:refresh', 'PayPay 残高を一括更新', ButtonStyle.Secondary, undefined, pp.length === 0),
    btn('ap:wallet:transfer', '利益を引き出す', ButtonStyle.Secondary, 'adm_wallet', pp.length === 0),
  ));
  comps.push(row(btn('ap:open:wallet', '表示を更新')));
  return { embeds: [embed], components: comps };
}

/* ────────────── ③ サーバー管理 ────────────── */

export function serverHome(notice?: Notice) {
  const embed = screen('サーバー管理パネル', '管理したい項目を選ぶ', [
    { icon: ADM.ng(), title: 'NG ワード管理', lines: ['一覧・追加・削除'] },
    { icon: ADM.user(), title: 'ユーザー管理', lines: ['ユーザーを選んで、情報・履歴・chip 付与・手動送金・BAN'] },
    { icon: ADM.chart(), title: '運営データ', lines: ['統計・出金の保留・最近の入金・当選告知の設定'] },
    { icon: ADM.wallet(), title: '売上', lines: ['月ごとの入金額・出金額・利益と累計'] },
    { icon: ADM.bullet(), title: 'コマンド', lines: ['`/mws` MWS で延長したら実行。7 日タイマーをリセット', '`/leet` 文字列を LEET 表記に変換', 'MWS の期限が近づくと、このチャンネルに通知が届く'] },
  ], notice, ADM.server());
  return {
    embeds: [embed],
    components: [row(
      btn('ap:open:ng', 'NG ワード管理', ButtonStyle.Secondary, 'adm_ng'),
      btn('ap:open:user', 'ユーザー管理', ButtonStyle.Secondary, 'adm_user'),
      btn('ap:open:ops', '運営データ', ButtonStyle.Secondary, 'adm_chart'),
      btn('ap:open:sales', '売上', ButtonStyle.Secondary, 'adm_wallet'),
    )],
  };
}

export function ngScreen(words: string[], notice?: Notice) {
  let body = '';
  let shown = 0;
  for (const w of words) {
    const piece = `${shown ? ', ' : ''}\`${w}\``;
    if (body.length + piece.length > 3000) break;
    body += piece; shown++;
  }
  if (shown < words.length) body += ` … ほか ${words.length - shown} 語`;
  const embed = screen('NG ワード管理', '投稿に含まれると伏字にして投稿し直します', [
    { icon: ADM.ng(), title: `登録中 (${words.length})`, lines: [body || '_なし_'] },
  ], notice, ADM.ng());
  return {
    embeds: [embed],
    components: [row(
      btn('ap:ng:add', '追加', ButtonStyle.Primary, 'adm_check'),
      btn('ap:ng:remove', '削除', ButtonStyle.Secondary),
      btn('ap:open:server', '戻る'),
    )],
  };
}

export interface UserSummary { id: string; pp: number; ltc: number; banned: boolean }

export function userScreen(sel: UserSummary | undefined, notice?: Notice) {
  const target: Section = sel
    ? { icon: ADM.user(), title: '選択中のユーザー', lines: [
        `<@${sel.id}>${sel.banned ? '  **BAN 中**' : ''}`,
        `${ICON.paypay()} PayPay 由来 ¥${sel.pp.toLocaleString()}   ${ICON.ltc()} LTC 由来 ¥${sel.ltc.toLocaleString()}`,
      ] }
    : { icon: ADM.user(), title: '選択中のユーザー', lines: ['_上の欄でユーザーを選んでください_'] };
  const embed = screen('ユーザー管理', 'ユーザーを選んでから操作を押す', [
    target,
    { icon: ADM.bullet(), title: '操作', lines: [
      '情報 / 取引履歴: 別の画面に表示',
      'chip 付与: 金額を入力 (マイナスで減らす)。実際のお金は動かない',
      'PayPay / LTC 手動送金: 運営ウォレットから送金。chip は動かない',
    ] },
  ], notice, ADM.user());
  const pick = new UserSelectMenuBuilder().setCustomId('ap:user:pick').setPlaceholder('ユーザーを選ぶ');
  if (sel) pick.setDefaultUsers(sel.id);
  const none = !sel;
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(pick),
      row(
        btn('ap:user:info', '情報', ButtonStyle.Secondary, 'adm_user', none),
        btn('ap:user:history', '取引履歴', ButtonStyle.Secondary, undefined, none),
        btn('ap:user:ban', 'BAN', ButtonStyle.Danger, 'adm_ban', none || !!sel?.banned),
        btn('ap:user:unban', 'BAN 解除', ButtonStyle.Secondary, undefined, none || !sel?.banned),
      ),
      row(
        btn('ap:user:grant:pp', 'chip 付与 (PayPay 由来)', ButtonStyle.Secondary, 'pay_paypay', none),
        btn('ap:user:grant:ltc', 'chip 付与 (LTC 由来)', ButtonStyle.Secondary, 'pay_ltc', none),
      ),
      row(
        btn('ap:user:sendpp', 'PayPay 手動送金', ButtonStyle.Secondary, 'pay_paypay', none),
        btn('ap:user:sendltc', 'LTC 手動送金', ButtonStyle.Secondary, 'pay_ltc', none),
      ),
      backRow('server'),
    ],
  };
}

export function opsScreen(ach: { channelId: string | null; baseName: string | null }, notice?: Notice) {
  const embed = screen('運営データ', '統計や出金の状況を確認', [
    { icon: ADM.chart(), title: '確認', lines: ['統計 / 出金の保留 / 最近の入金: 別の画面に表示'] },
    { icon: ADM.badge(), title: '当選告知', lines: [
      ach.channelId ? `投稿先: <#${ach.channelId}> (名前: ${ach.baseName ?? '-'})` : '投稿先: _未設定_',
      '下の欄でチャンネルを選ぶと設定。件数に合わせてチャンネル名も変わる',
    ] },
  ], notice, ADM.chart());
  const ch = new ChannelSelectMenuBuilder().setCustomId('ap:ops:achch').setPlaceholder('当選告知の投稿先チャンネルを選ぶ')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  if (ach.channelId) ch.setDefaultChannels(ach.channelId);
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(ch),
      row(
        btn('ap:ops:stats', '統計', ButtonStyle.Primary, 'adm_chart'),
        btn('ap:ops:pending', '出金の保留', ButtonStyle.Secondary),
        btn('ap:ops:deposits', '最近の入金', ButtonStyle.Secondary),
        btn('ap:ops:achoff', '当選告知を止める', ButtonStyle.Secondary, undefined, !ach.channelId),
      ),
      backRow('server'),
    ],
  };
}

/* ────────────── 入力画面 ────────────── */

const input = (id: string, label: string, opts: { required?: boolean; placeholder?: string; paragraph?: boolean } = {}) => {
  const t = new TextInputBuilder().setCustomId(id).setLabel(label).setRequired(opts.required ?? true)
    .setStyle(opts.paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short);
  if (opts.placeholder) t.setPlaceholder(opts.placeholder);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(t);
};
export function adminModal(id: string, title: string, fields: Array<Parameters<typeof input>>) {
  return new ModalBuilder().setCustomId(id).setTitle(title.slice(0, 45)).addComponents(...fields.map(f => input(...f)));
}

/* ────────────── MWS 7 日タイマー (/mws と期限前の通知) ────────────── */

/** /mws を実行した人だけに見える結果 */
export function mwsResetScreen(expiresAt: number, notifyChannels: string[]) {
  return { embeds: [screen('MWS タイマー', 'MWS で延長したら /mws を実行', [
    { icon: ADM.check(), title: 'リセットしました', lines: [`次の期限: <t:${expiresAt}:f> (<t:${expiresAt}:R>)`] },
    { icon: ADM.server(), title: '通知先', lines: notifyChannels.length
      ? [...notifyChannels.map(id => `<#${id}>`), '残り 24 時間・6 時間・1 時間と、期限切れの時に届く']
      : ['サーバー管理パネルが設置されていないので、通知は届きません', '/admin panel でサーバー管理パネルを設置してください'] },
  ], undefined, ADM.server())] };
}

/** 期限が近づいた時にサーバー管理パネルのチャンネルへ送る通知 */
export function mwsWarningEmbed(bucket: 24 | 6 | 1 | 'expired', expiresAt: number) {
  const expired = bucket === 'expired';
  const title = expired ? 'MWS の期限が切れました' : `MWS の期限まで残り ${bucket} 時間`;
  const lines = expired
    ? ['MWS のダッシュボードですぐに延長し、そのあと `/mws` を実行']
    : [`期限: <t:${expiresAt}:f> (<t:${expiresAt}:R>)`, 'MWS のダッシュボードで延長し、そのあと `/mws` を実行'];
  return panelEmbed({
    icon: ADM.server(), title, tagline: 'MWS 7 日タイマー', sections: [{ icon: ADM.badge(), title: 'やること', lines }],
    color: expired || bucket === 1 ? COLOR.black : COLOR.violet, footer: 'C4sino · 管理通知', bullet: ADM.bullet(), deco: '',
  });
}

/** 運営の LTC アドレスに届いたが、どの入金申請とも量が合わなかった送金 */
export function ltcUnmatchedEmbed(address: string, txid: string, valueSat: number) {
  return panelEmbed({
    icon: ADM.wallet(), title: '照合できない LTC 入金', tagline: '自動では残高に反映していません', color: COLOR.black,
    bullet: ADM.bullet(), deco: '', footer: 'C4sino · 管理通知',
    sections: [
      { icon: ADM.badge(), title: '届いた送金', lines: [`量: \`${(valueSat / 1e8).toFixed(8)}\` LTC`, `送金番号: \`${txid}\``, `送金先: \`${address}\``] },
      { icon: ADM.user(), title: 'やること', lines: ['送った本人に確認して、ユーザー管理から chip を付与する', '量がずれたか、期限を過ぎてから送られた可能性があります'] },
    ],
  });
}

/* ────────────── 売上 ────────────── */

export interface SalesPeriod { depPaypay: number; depLtc: number; wdPaypay: number; wdLtc: number }
/** months は新しい月から順。先頭が今月。month は "2026-11" の形 */
export interface SalesSummary { months: Array<SalesPeriod & { month: string }>; userBalance: number }

const yen = (n: number) => `${n < 0 ? '-' : ''}¥${Math.abs(n).toLocaleString()}`;
const monthLabel = (m: string) => `${m.slice(0, 4)}年${Number(m.slice(5, 7))}月`;
const dep = (p: SalesPeriod) => p.depPaypay + p.depLtc;
const wd  = (p: SalesPeriod) => p.wdPaypay + p.wdLtc;

export function salesScreen(sum: SalesSummary) {
  const [now, ...past] = sum.months;
  const total = sum.months.reduce((a, p) => ({
    depPaypay: a.depPaypay + p.depPaypay, depLtc: a.depLtc + p.depLtc, wdPaypay: a.wdPaypay + p.wdPaypay, wdLtc: a.wdLtc + p.wdLtc,
  }), { depPaypay: 0, depLtc: 0, wdPaypay: 0, wdLtc: 0 });
  const detail = (p: SalesPeriod) => [
    `入金 **${yen(dep(p))}** (PayPay ${yen(p.depPaypay)} / LTC ${yen(p.depLtc)})`,
    `出金 **${yen(wd(p))}** (PayPay ${yen(p.wdPaypay)} / LTC ${yen(p.wdLtc)})`,
    `利益 **${yen(dep(p) - wd(p))}**`,
  ];
  const shown = past.slice(0, 12);
  const pastLines = shown.length
    ? shown.map(p => `${monthLabel(p.month)}  利益 **${yen(dep(p) - wd(p))}** (入金 ${yen(dep(p))} / 出金 ${yen(wd(p))})`)
    : ['_まだありません_'];
  if (past.length > shown.length) pastLines.push(`ほか ${past.length - shown.length} か月 (累計に含む)`);
  const embed = screen('売上', '月ごとの 入金 − 出金 = 利益', [
    { icon: ADM.chart(), title: `今月 (${monthLabel(now.month)})`, lines: detail(now) },
    { icon: ADM.chart(), title: '過去の月', lines: pastLines },
    { icon: ADM.wallet(), title: '累計', lines: detail(total) },
    { icon: ADM.bullet(), title: '数え方', lines: [
      '入金: 残高に反映した入金 / 出金: 送り終えた出金 (ユーザーに届いた額)',
      '月は日本時間で区切る。chip 付与と 0 円のテストプレイは含めない',
      `ユーザーが今持っている残高の合計: ${yen(sum.userBalance)} (これから出金される可能性がある額)`,
    ] },
  ], undefined, ADM.wallet());
  return { embeds: [embed], components: [row(btn('ap:open:sales', '表示を更新'), btn('ap:open:server', '戻る'))] };
}
