/**
 * 全ゲーム共通の「テーブル」画面。PLAY で本人だけに見える画面を 1 枚開き、以降のプレイは
 * すべてその画面の中で進む。賭け金はユーザー x ゲームごとに覚え、BET 1 回で次のゲームへ進める。
 *
 * 画面の段組み (全ゲーム共通):
 *   1 段目  ゲーム固有の選択   (バカラ: 賭け先 / ルーレット: 掛け方 / クラップス: 賭けの種類)
 *   2 段目  ゲーム中の操作     (BJ: HIT/STAND/DOUBLE/SPLIT / VP: HOLD x5)
 *   次の段  [½] [2×] [金額変更] [入金]
 *   最後    メイン操作         (BET ¥x / VP: DRAW / クラップス: ROLL・UNDO・END)
 */
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ModalBuilder,
  PermissionFlagsBits, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type Client, type ModalSubmitInteraction, type StringSelectMenuInteraction,
} from 'discord.js';
import { db, getBalance, txCredit, ensureUser, assertNotBanned, getReserves, applyMix, payoutByMix } from './db/schema.js';
import * as sessions from './games/session-store.js';
import type { BetMix } from './games/session-store.js';
import { startHand, availableActions, apply, newShoe, isBlackjack, type BJState } from './games/blackjack.js';
import { spinWithCap, reelStrip } from './games/slots.js';
import { spinRouletteWithCap, payoutMult as rouPayout, type BetKind as RouKind } from './games/roulette.js';
import { dealBaccaratWithCap, payoutMult as bacPayout, type Side as BacSide } from './games/baccarat.js';
import { startVP, drawVPWithCap, payoutFor, type VPHand } from './games/videopoker.js';
import { newCraps, addBet, roll as crapsRoll, rollDie, openExposure, isLocked, type CrapsBetKind, type CrapsState, type CrapsBet } from './games/craps.js';
import { MINES_SIZES, newMines, parseOpt as minesOpt, optOf as minesOptOf, multiplier as minesMult, payoutOf as minesPayout, openCell, openedCount, safeCount, type MinesSize, type MinesState } from './games/mines.js';
import {
  formatBlackjack, formatSlots, formatRoulette, formatBaccarat, formatVideoPoker,
  crapsDiceLine, cardButtonEmoji, cardText, slotEmoji,
} from './ui/format-games.js';
import { bjActionsRow } from './ui/panels.js';
import { housePayoutCap, clampPayout, housePayoutCapSync, clampPayoutSync, setCrapsExposure, clearCrapsExposure, MAX_GROSS_MULT } from './payments/liquidity.js';
import { randomUUID } from 'node:crypto';
import * as ach from './achievements.js';
import { MIN_BET_CHIPS, MAX_BET_CHIPS } from './payments/limits.js';
import { L } from './ui/leet.js';
import { emoji, emojiRef } from './ui/emoji-ids.js';
import { COLOR, GAME_ICON, ICON } from './ui/theme.js';

export type Game = 'blackjack' | 'slots' | 'roulette' | 'baccarat' | 'videopoker' | 'craps' | 'mines';
export const GAMES: readonly Game[] = ['blackjack', 'slots', 'roulette', 'baccarat', 'videopoker', 'craps', 'mines'];
export const isGame = (s: string): s is Game => (GAMES as readonly string[]).includes(s);

type TI = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;

let client: Client | null = null;
export function setTablesClient(c: Client) { client = c; }

/* ────────────── 共通定数 ────────────── */

/** テストプレイで払戻しを計算するための仮 BET。残高からは引かれない。 */
export const TEST_BET = 100;

export const BET_LIMITS = Object.fromEntries(
  (['blackjack', 'slots', 'roulette', 'baccarat', 'videopoker', 'craps', 'mines'] as const)
    .map(g => [g, { min: MIN_BET_CHIPS[g], max: MAX_BET_CHIPS[g] }]),
) as Record<Game, { min: number; max: number }>;

const TITLE: Record<Game, string> = {
  blackjack:  `🂡 ${L('BLACKJACK')}`,
  slots:      `🎰 ${L('SLOTS')}`,
  roulette:   `🎡 ${L('ROULETTE')}`,
  baccarat:   `🎴 ${L('BACCARAT')}`,
  videopoker: `🃏 ${L('VIDEO POKER')}`,
  craps:      `🎲 ${L('CRAPS')}`,
  mines:      `💣 ${L('MINES')}`,
};

const NAME: Record<Game, string> = {
  blackjack: L('BLACKJACK'), slots: L('SLOTS'), roulette: L('ROULETTE'),
  baccarat: L('BACCARAT'), videopoker: L('VIDEO POKER'), craps: L('CRAPS'), mines: L('MINES'),
};

/** 登録済みのアプリ絵文字があればボタンに付ける。 */
function withEmoji(b: ButtonBuilder, name: string): ButtonBuilder {
  const ref = emojiRef(name);
  return ref ? b.setEmoji(ref) : b;
}

const ROU_KINDS: Array<[RouKind, string, string]> = [
  ['red',    'Red (×2)',             '赤の数字 — 18/37'],
  ['black',  'Black (×2)',           '黒の数字 — 18/37'],
  ['even',   'Even (×2)',            '偶数 (0 除く) — 18/37'],
  ['odd',    'Odd (×2)',             '奇数 — 18/37'],
  ['low',    '1–18 Low (×2)',        '下半分 — 18/37'],
  ['high',   '19–36 High (×2)',      '上半分 — 18/37'],
  ['dozen1', 'Dozen 1–12 (×3)',      '第 1 ダース — 12/37'],
  ['dozen2', 'Dozen 13–24 (×3)',     '第 2 ダース — 12/37'],
  ['dozen3', 'Dozen 25–36 (×3)',     '第 3 ダース — 12/37'],
  ['number', 'Single Number (×36)',  '単一数字 0〜36 — 1/37'],
];
const ROU_LABEL: Record<string, string> = Object.fromEntries(ROU_KINDS.map(([k, l]) => [k, l.replace(/ \(.*\)$/, '')]));

const BAC_SIDES: Array<[BacSide, string]> = [['player', 'Player'], ['banker', 'Banker'], ['tie', 'Tie']];

const CRAPS_KINDS: ReadonlyArray<readonly [CrapsBetKind, string]> = [
  ['pass',       'Pass Line (×2) — comeout 推奨'],
  ['dontpass',   "Don't Pass (×2) — 逆張り"],
  ['pass_odds',  'Pass Odds (×2.2-3) — ポイント必須, no edge'],
  ['dontpass_odds', "Don't Pass Odds — 要ポイント, no edge"],
  ['come',       'Come (×2) — ポイント中のみ'],
  ['dontcome',   "Don't Come — ポイント中のみ"],
  ['field',      'Field (×2 / ×3) — ワンロール'],
  ['place4',     'Place 4 (×2.8)'],
  ['place5',     'Place 5 (×2.4)'],
  ['place6',     'Place 6 (×2.17)'],
  ['place8',     'Place 8 (×2.17)'],
  ['place9',     'Place 9 (×2.4)'],
  ['place10',    'Place 10 (×2.8)'],
  ['hard4',      'Hard 4 (×8)'],
  ['hard6',      'Hard 6 (×10)'],
  ['hard8',      'Hard 8 (×10)'],
  ['hard10',     'Hard 10 (×8)'],
  ['big6',       'Big 6 (×2)'],
  ['big8',       'Big 8 (×2)'],
  ['any7',       'Any 7 (×5) — ワンロール'],
  ['anycraps',   'Any Craps (×8) — ワンロール'],
  ['yo11',       'Yo 11 (×16) — ワンロール'],
  ['snakeeyes',  'Snake Eyes 2 (×31) — ワンロール'],
  ['acedeuce',   'Ace-Deuce 3 (×16) — ワンロール'],
  ['boxcars',    'Boxcars 12 (×31) — ワンロール'],
] as const;

/** その局面でしか置けない賭け (書いていない種類はいつでも置ける) */
const CRAPS_WHEN: Partial<Record<CrapsBetKind, 'comeout' | 'point'>> = {
  pass: 'comeout', dontpass: 'comeout',
  pass_odds: 'point', dontpass_odds: 'point', come: 'point', dontcome: 'point',
};
/** 賭けの表示名 ('Pass Line (×2) — …' → 'Pass Line') */
const crapsName = (k: CrapsBetKind) => CRAPS_KINDS.find(([v]) => v === k)?.[1].split(' (')[0].split(' — ')[0] ?? k;

const VP_RANK_LABEL: Record<string, string> = {
  royal_flush: 'Royal Flush', straight_flush: 'Straight Flush', four_of_a_kind: 'Four of a Kind',
  full_house: 'Full House', flush: 'Flush', straight: 'Straight', three_of_a_kind: 'Three of a Kind',
  two_pair: 'Two Pair', jacks_or_better: 'Jacks or Better', nothing: 'No Win',
};

/* ────────────── 覚えている賭け金 (ユーザー x ゲーム) ────────────── */

db.exec(`CREATE TABLE IF NOT EXISTS bet_prefs (
  discord_id TEXT NOT NULL,
  game       TEXT NOT NULL,
  pp         INTEGER NOT NULL DEFAULT 0,
  ltc        INTEGER NOT NULL DEFAULT 0,
  test       INTEGER NOT NULL DEFAULT 0,
  opt        TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (discord_id, game)
);`);

export interface Prefs {
  pp: number;
  ltc: number;
  /** 管理者が金額変更で両方 0 にしたとき。仮 BET で遊び、残高は動かさない。 */
  test: boolean;
  /** バカラ: 賭け先 / ルーレット: 掛け方 ('number:17' は数字指定) */
  opt: string;
}

function defaultOpt(game: Game): string {
  return game === 'baccarat' ? 'player' : game === 'roulette' ? 'red' : game === 'mines' ? '4x4:3' : '';
}

export function getPrefs(uid: string, game: Game): Prefs {
  const r = db.prepare('SELECT pp, ltc, test, opt FROM bet_prefs WHERE discord_id=? AND game=?').get(uid, game) as
    { pp: number; ltc: number; test: number; opt: string } | undefined;
  if (!r) return { pp: 0, ltc: 0, test: false, opt: defaultOpt(game) };
  return { pp: r.pp, ltc: r.ltc, test: !!r.test, opt: r.opt || defaultOpt(game) };
}

export function savePrefs(uid: string, game: Game, p: Prefs) {
  db.prepare(`INSERT INTO bet_prefs(discord_id, game, pp, ltc, test, opt, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, strftime('%s','now'))
    ON CONFLICT(discord_id, game) DO UPDATE SET pp=excluded.pp, ltc=excluded.ltc, test=excluded.test,
      opt=excluded.opt, updated_at=excluded.updated_at`)
    .run(uid, game, p.pp, p.ltc, p.test ? 1 : 0, p.opt);
}

const isUnset = (p: Prefs) => !p.test && p.pp + p.ltc === 0;

/** 管理者 (サーバー管理権限) だけがテストプレイできる。 */
export function canTestPlay(i: { memberPermissions: Readonly<{ has(p: bigint): boolean }> | null }): boolean {
  return i.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

/* ────────────── 金額入力 ────────────── */

function parseStrictInt(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = raw.replace(/[,\s¥]/g, '');
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/** 全ゲーム共通の BET 金額入力。PayPay 由来 / LTC 由来をそれぞれ入力させる。今の設定を初期値にする。 */
export function betMixModal(i: ButtonInteraction | StringSelectMenuInteraction, customId: string, title: string, current?: Prefs): ModalBuilder {
  const r = getReserves(i.user.id);
  const placeholder = canTestPlay(i)
    ? '管理者: 両方 0 でテストプレイ (残高は動きません)'
    : '0 以上の整数 (使わないなら 0)';
  const field = (id: 'pp' | 'ltc', label: string, value: number) => new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short)
      .setPlaceholder(placeholder).setValue(String(value)).setRequired(true));
  return new ModalBuilder().setCustomId(customId).setTitle(title.slice(0, 45)).addComponents(
    field('pp',  `PayPay 由来 (保有 ¥${r.pp.toLocaleString()})`, current?.test ? 0 : current?.pp ?? 0),
    field('ltc', `LTC 由来 (保有 ¥${r.ltc.toLocaleString()})`,    current?.test ? 0 : current?.ltc ?? 0),
  );
}

/** betMixModal の入力を読む。不正ならエラーを返信して null。管理者の 0/0 はテストプレイ。 */
async function readBetMix(i: ModalSubmitInteraction): Promise<{ pp: number; ltc: number; test: boolean } | null> {
  const pp  = parseStrictInt(i.fields.getTextInputValue('pp'));
  const ltc = parseStrictInt(i.fields.getTextInputValue('ltc'));
  if (pp === null || ltc === null || pp < 0 || ltc < 0) {
    await i.reply({ content: '金額は 0 以上の整数で入力してください', flags: MessageFlags.Ephemeral });
    return null;
  }
  if (pp + ltc === 0) {
    if (canTestPlay(i)) return { pp: 0, ltc: 0, test: true };
    await i.reply({ content: 'PayPay と LTC のどちらかに 1 以上の金額を入れてください', flags: MessageFlags.Ephemeral });
    return null;
  }
  return { pp, ltc, test: false };
}

function numberModal(customId: string): ModalBuilder {
  return new ModalBuilder().setCustomId(customId).setTitle(`${L('ROULETTE')} — Single Number`.slice(0, 45)).addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId('num').setLabel('数字 (0〜36)').setStyle(TextInputStyle.Short).setRequired(true)),
  );
}

/* ────────────── 画面の組み立て ────────────── */

type Field = { name: string; value: string; inline?: boolean };

interface View {
  game: Game;
  uid: string;
  prefs: Prefs;
  /** この表示がテストか (進行中のラウンドの状態。未指定なら prefs.test) */
  test?: boolean;
  board?: string;
  result?: string;
  notice?: string;
  color?: number;
  /** ラウンドの途中。金額の段と BET を押せなくする */
  inRound?: boolean;
  actions?: ActionRowBuilder<ButtonBuilder>[];
  primary?: ActionRowBuilder<ButtonBuilder>;
  fields?: Field[];
  sid?: string;
  /** クラップス: 今の局面 (選択メニューに出す賭けが変わる) */
  phase?: 'comeout' | 'point';
  /** ゲーム中の盤面だけ出す (マインスイーパーはマスのボタンで段を使い切るため) */
  bare?: boolean;
}

/** 直近の盤面と結果。金額を変えたときなどに、盤面を消さずに残すため。 */
const lastShown = new Map<string, { board?: string; result?: string; color?: number }>();
const key = (uid: string, game: Game) => `${uid}:${game}`;

function betText(p: Prefs): string {
  if (p.test) return `TEST (仮 ¥${TEST_BET})`;
  if (isUnset(p)) return '未設定';
  return `¥${(p.pp + p.ltc).toLocaleString()}  (PP ¥${p.pp.toLocaleString()} / LTC ¥${p.ltc.toLocaleString()})`;
}

function optText(game: Game, p: Prefs): Field | null {
  if (game === 'mines') { const m = minesOpt(p.opt); return { name: 'マス / 爆弾', value: `${m.size}×${m.size} / 爆弾 ${m.mines}`, inline: true }; }
  if (game === 'baccarat') return { name: '賭け先', value: BAC_SIDES.find(([s]) => s === p.opt)?.[1] ?? p.opt, inline: true };
  if (game === 'roulette') {
    const [kind, n] = p.opt.split(':');
    return { name: '掛け方', value: kind === 'number' ? (n ? `Single Number ${n}` : 'Single Number (数字未指定)') : (ROU_LABEL[kind] ?? kind), inline: true };
  }
  return null;
}

/** マインスイーパー: マスの数と爆弾の数の選択 (2 段) */
function minesOptionRows(p: Prefs, disabled: boolean): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const cur = minesOpt(p.opt);
  const size = new StringSelectMenuBuilder().setCustomId('t:mines:size').setPlaceholder('マスの数').setDisabled(disabled)
    .addOptions(MINES_SIZES.map(n => new StringSelectMenuOptionBuilder()
      .setValue(String(n)).setLabel(`${n}×${n} マス`).setDescription(`${n * n} マス`).setDefault(n === cur.size)));
  const n = cur.size * cur.size;
  const count = new StringSelectMenuBuilder().setCustomId('t:mines:count').setPlaceholder('爆弾の数').setDisabled(disabled)
    .addOptions(Array.from({ length: n - 1 }, (_, k) => k + 1).map(m => new StringSelectMenuOptionBuilder()
      .setValue(String(m)).setLabel(`爆弾 ${m} 個`)
      .setDescription(`1 マス目 ×${minesMult(cur.size, m, 1)} / 宝石 ${n - m} マス`).setDefault(m === cur.mines)));
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(size), new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(count)];
}

function optionsRow(game: Game, p: Prefs, disabled: boolean, sid?: string, phase: 'comeout' | 'point' = 'comeout'): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder> | null {
  if (game === 'baccarat') {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      BAC_SIDES.map(([side, label]) => new ButtonBuilder()
        .setCustomId(`t:baccarat:side:${side}`).setLabel(label).setDisabled(disabled)
        .setStyle(p.opt === side ? ButtonStyle.Primary : ButtonStyle.Secondary)),
    );
  }
  if (game === 'roulette') {
    const [cur, n] = p.opt.split(':');
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId('t:roulette:kind').setPlaceholder('掛け方を選択').setDisabled(disabled)
        .addOptions(ROU_KINDS.map(([k, label, desc]) => new StringSelectMenuOptionBuilder()
          .setValue(k).setLabel(label)
          .setDescription(k === 'number' && cur === 'number' && n ? `選択中: ${n}` : desc)
          .setDefault(k === cur))),
    );
  }
  if (game === 'craps') {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(sid ? `cr:add:${sid}` : 'cr:add').setPlaceholder('賭けの種類を選ぶと、今の BET 額で台に置きます').setDisabled(disabled)
        .addOptions(CRAPS_KINDS.filter(([v]) => !CRAPS_WHEN[v] || CRAPS_WHEN[v] === phase)
          .map(([v, l]) => new StringSelectMenuOptionBuilder().setValue(v).setLabel(l.slice(0, 100)))),
    );
  }
  return null;
}

function betBarRow(game: Game, p: Prefs, disabled: boolean): ActionRowBuilder<ButtonBuilder> {
  const scaleOff = disabled || p.test || isUnset(p);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`t:${game}:half`).setLabel('½').setStyle(ButtonStyle.Secondary).setDisabled(scaleOff),
    new ButtonBuilder().setCustomId(`t:${game}:double`).setLabel('2×').setStyle(ButtonStyle.Secondary).setDisabled(scaleOff),
    new ButtonBuilder().setCustomId(`t:${game}:amt`).setLabel('金額変更').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    withEmoji(new ButtonBuilder().setCustomId(`dep:open:${game}`).setLabel('入金').setStyle(ButtonStyle.Secondary).setDisabled(disabled), 'ui_wallet'),
  );
}

function betButtonRow(game: Game, p: Prefs, disabled: boolean): ActionRowBuilder<ButtonBuilder> {
  const label = p.test ? `TEST BET (仮 ¥${TEST_BET})` : isUnset(p) ? 'BET 額を設定' : `BET ¥${(p.pp + p.ltc).toLocaleString()}`;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(`t:${game}:bet`).setLabel(label).setStyle(ButtonStyle.Primary).setDisabled(disabled), 'ui_chip'),
  );
}

function renderTable(v: View) {
  const test = v.test ?? v.prefs.test;
  const r = getReserves(v.uid);
  const desc: string[] = [`### ${GAME_ICON[v.game]() || TITLE[v.game].split(' ')[0]} ${NAME[v.game]}${test ? '  [TEST]' : ''}`];
  if (test) desc.push(`**テストプレイ** — 仮の BET ${TEST_BET} で計算。残高・履歴・実績には反映されません`);
  if (v.board) desc.push(v.board);
  if (v.result) desc.push(v.result);
  if (v.notice) desc.push(`**注意**  ${v.notice}`);
  if (!v.board && !v.result && !v.notice) desc.push(v.game === 'craps' ? '_賭けの種類を選んで台に置き、ROLL で振ります_' : '_BET を押すとゲームが始まります_');

  const opt = optText(v.game, v.prefs);
  const embed = new EmbedBuilder()
    .setColor(v.color ?? COLOR.violet)
    .setDescription(desc.join('\n\n').slice(0, 4096))
    .addFields(
      ...(v.fields ?? []),
      { name: 'BET', value: betText(v.prefs), inline: true },
      ...(opt ? [opt] : []),
      { name: '残高', value: `PP ¥${r.pp.toLocaleString()} / LTC ¥${r.ltc.toLocaleString()}`, inline: true },
    );

  const rows: ActionRowBuilder<any>[] = [];
  if (v.bare) {
    rows.push(...(v.actions ?? []));
    if (v.primary) rows.push(v.primary);
    return { content: '', embeds: [embed], components: rows.slice(0, 5), files: [], attachments: [] };
  }
  if (v.game === 'mines') rows.push(...minesOptionRows(v.prefs, !!v.inRound));
  const o = optionsRow(v.game, v.prefs, !!v.inRound, v.sid, v.phase);
  if (o) rows.push(o);
  if (v.actions) rows.push(...v.actions);
  rows.push(betBarRow(v.game, v.prefs, !!v.inRound));
  rows.push(v.primary ?? betButtonRow(v.game, v.prefs, !!v.inRound));
  return { content: '', embeds: [embed], components: rows.slice(0, 5), files: [], attachments: [] };
}

/** 結果行。テストでも同じ見た目で出す。 */
function resultLine(bet: number, payout: number): { text: string; color: number } {
  const net = payout - bet;
  if (net > 0) return { text: `**WIN  +¥${net.toLocaleString()}**  (払戻 ¥${payout.toLocaleString()})`, color: COLOR.purple };
  if (net < 0 && payout > 0) return { text: `**LOSE  -¥${(-net).toLocaleString()}**  (払戻 ¥${payout.toLocaleString()})`, color: COLOR.black };
  if (net < 0) return { text: `**LOSE  -¥${bet.toLocaleString()}**`, color: COLOR.black };
  return { text: '**PUSH**  — BET 返却', color: COLOR.silver };
}

/** +¥1,200 / -¥400 の形 */
const signedYen = (n: number) => `${n < 0 ? '-' : '+'}¥${Math.abs(n).toLocaleString()}`;

/* ────────────── 応答の共通処理 ────────────── */

/** 本人の操作は同時に 1 つだけ (BET の連打で二重に引き落とさないため)。 */
const busy = new Set<string>();

/** テーブル画面上の操作なら、その画面を書き換える先行応答。 */
async function ack(i: TI) {
  if (i.deferred || i.replied) return;
  if (i.isModalSubmit()) {
    if (i.isFromMessage()) await i.deferUpdate();
    else await i.deferReply({ flags: MessageFlags.Ephemeral });
    return;
  }
  await i.deferUpdate();
}

async function show(i: TI, v: View) {
  if (v.board || v.result) lastShown.set(key(v.uid, v.game), { board: v.board, result: v.result, color: v.color });
  await i.editReply(renderTable(v));
}

/** 盤面を残したまま、金額や賭け先だけ表示し直す。 */
async function refresh(i: TI, game: Game, notice?: string) {
  await ack(i);
  if (game === 'craps') {
    const sid = sidOf(i);
    const entry = sid ? sessions.get(sid) : undefined;
    if (entry && entry.discordId === i.user.id) return show(i, crapsView(i.user.id, sid!, entry.state as CrapsState, notice));
    return openCrapsTable(i, notice);
  }
  const last = notice ? undefined : lastShown.get(key(i.user.id, game));
  return show(i, { game, uid: i.user.id, prefs: getPrefs(i.user.id, game), ...last, notice });
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/**
 * 進行中のセッション ID。押されたボタン/メニューの customId に入れてある。
 * 金額変更など ID を持たない操作では、同じ画面の他のボタンから探す。
 * (以前の画面はフッターに sid=… を出していたので、それも読む)
 */
function sidOf(i: TI): string | null {
  const own = i.customId.match(UUID);
  if (own) return own[0];
  const msg = 'message' in i ? i.message : null;
  for (const row of (msg?.components ?? []) as any[]) {
    for (const c of row.components ?? []) {
      const m = String(c.customId ?? c.custom_id ?? '').match(UUID);
      if (m) return m[0];
    }
  }
  const footer = msg?.embeds?.[0]?.footer?.text;
  return footer?.match(/sid=([0-9a-f-]+)/)?.[1] ?? null;
}

/** 払戻し上限。テストでは運営残高による上限をかけない。 */
async function capFor(test: boolean, crapsSid?: string): Promise<number> {
  return test ? Number.MAX_SAFE_INTEGER : housePayoutCap(crapsSid);
}
/** `capFor` の同期版。atomic に (cap 読み → 結果決定 → 予約) まで await を挟まないために使う。 */
function capForSync(test: boolean, sid?: string): number {
  return test ? Number.MAX_SAFE_INTEGER : housePayoutCapSync(sid);
}

/** 勝ったら記録して当たり通知を出す。extra は通知の表示だけに使う (掛け方・PayPay / LTC の内訳)。 */
async function settled(i: TI, game: Game, bet: number, payout: number, test: boolean, extra?: { mix?: BetMix; detail?: string }) {
  if (test || !i.guildId || !client) return;
  const net = payout - bet;
  if (net <= 0) return;
  const member = i.member && 'displayAvatarURL' in i.member ? i.member : null;
  const rec = {
    guildId: i.guildId, discordId: i.user.id, game, bet, payout, net, ...extra,
    userName: member?.displayName ?? i.user.displayName ?? i.user.username,
    avatarUrl: (member ?? i.user).displayAvatarURL({ size: 256 }),
  };
  ach.recordAchievement(rec);
  await ach.announce(client, rec).catch(e => console.error('[ach] announce failed:', (e as Error).message));
}

function credit(uid: string, amount: number, mix: BetMix | undefined, reason: string, ref?: string) {
  if (amount <= 0) return;
  if (mix) payoutByMix(uid, amount, mix, reason, ref);
  else txCredit(uid, amount, reason, ref);
}

/* ────────────── 入口 ────────────── */

/** チャンネルのパネルの PLAY: 本人だけに見えるテーブルを新しく開く。opt があれば賭け先/掛け方を先に選ぶ。 */
export async function openTable(i: ButtonInteraction, game: Game, opt?: string) {
  assertNotBanned(i.user.id);
  ensureUser(i.user.id);
  if (opt && (game === 'baccarat' || game === 'roulette')) {
    const p = getPrefs(i.user.id, game);
    savePrefs(i.user.id, game, { ...p, opt });
  }
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  if (game === 'craps') return openCrapsTable(i);
  if (game === 'mines') { const active = activeMines(i.user.id); if (active) return renderMines(i, active, '進行中のゲームの続きです'); }
  const last = lastShown.get(key(i.user.id, game));
  return show(i, { game, uid: i.user.id, prefs: getPrefs(i.user.id, game), ...last });
}

/** 入金完了画面などの Replay: その画面をテーブルに変えて、覚えている額ですぐ 1 回プレイする。 */
export async function replayInPlace(i: ButtonInteraction, game: Game) {
  assertNotBanned(i.user.id);
  ensureUser(i.user.id);
  if (game === 'craps') { await ack(i); return openCrapsTable(i); }
  return onBet(i, game);
}

/** t:<game>:<action>[:arg] のボタン */
export async function onTableButton(i: ButtonInteraction) {
  const [, g, action, arg] = i.customId.split(':');
  if (!isGame(g)) return;
  assertNotBanned(i.user.id);
  ensureUser(i.user.id);
  const game = g;
  const p = getPrefs(i.user.id, game);

  if (action === 'bet') return onBet(i, game);
  if (action === 'amt') return i.showModal(betMixModal(i, `t:${game}:amtset`, `${game.toUpperCase()} — BET 金額`, p));
  if (action === 'half' || action === 'double') {
    if (!p.test && !isUnset(p)) {
      const f = (n: number) => action === 'half' ? Math.floor(n / 2) : n * 2;
      savePrefs(i.user.id, game, { ...p, pp: f(p.pp), ltc: f(p.ltc) });
    }
    return refresh(i, game);
  }
  if (game === 'baccarat' && action === 'side' && BAC_SIDES.some(([s]) => s === arg)) {
    savePrefs(i.user.id, game, { ...p, opt: arg });
    return refresh(i, game);
  }
}

/** テーブル上の選択メニュー (ルーレットの掛け方、クラップスの賭けの種類) */
export async function onTableSelect(i: StringSelectMenuInteraction) {
  assertNotBanned(i.user.id);
  ensureUser(i.user.id);
  const v = i.values[0];
  if (i.customId === 't:roulette:kind') {
    if (v === 'number') return i.showModal(numberModal('t:roulette:num'));
    const p = getPrefs(i.user.id, 'roulette');
    savePrefs(i.user.id, 'roulette', { ...p, opt: v });
    return refresh(i, 'roulette');
  }
  if (i.customId.startsWith('cr:add')) return onCrapsAdd(i, v as CrapsBetKind);
  if (i.customId === 't:mines:size' || i.customId === 't:mines:count') {
    const p = getPrefs(i.user.id, 'mines');
    const cur = minesOpt(p.opt);
    const n = Number(v);
    const next = i.customId === 't:mines:size'
      ? minesOptOf(n as MinesSize, Math.min(cur.mines, n * n - 1))
      : minesOptOf(cur.size, n);
    savePrefs(i.user.id, 'mines', { ...p, opt: next });
    return refresh(i, 'mines');
  }
}

/** テーブルから開いた入力画面の送信 */
export async function onTableModal(i: ModalSubmitInteraction) {
  const [, g, action, arg] = i.customId.split(':');
  if (!isGame(g)) return;
  assertNotBanned(i.user.id);
  ensureUser(i.user.id);
  const game = g;
  const p = getPrefs(i.user.id, game);

  if (action === 'amtset' || action === 'amtbet' || action === 'amtadd') {
    const b = await readBetMix(i);
    if (!b) return;
    savePrefs(i.user.id, game, { ...p, ...b });
    if (action === 'amtbet') return onBet(i, game);
    if (action === 'amtadd') return onCrapsAdd(i, arg as CrapsBetKind);
    return refresh(i, game);
  }
  if (game === 'roulette' && (action === 'num' || action === 'numbet')) {
    const n = parseStrictInt(i.fields.getTextInputValue('num'));
    if (n === null || n < 0 || n > 36) return i.reply({ content: '数字は 0〜36 の整数で入力してください', flags: MessageFlags.Ephemeral });
    savePrefs(i.user.id, 'roulette', { ...p, opt: `number:${n}` });
    if (action === 'numbet') return onBet(i, 'roulette');
    return refresh(i, 'roulette');
  }
}

/* ────────────── BET (覚えている額で 1 回プレイ) ────────────── */

interface Round { uid: string; game: Game; p: Prefs; bet: number; mix?: BetMix; test: boolean }

/**
 * 入力画面を出す必要があればここで出す (先行応答の前でないと出せない)。
 * 準備ができたら先行応答して Round を返す。返せないときは画面に理由を出して null。
 */
async function prepareRound(i: TI, game: Game): Promise<Round | null> {
  const uid = i.user.id;
  let p = getPrefs(uid, game);
  if (p.test && !canTestPlay(i)) { p = { ...p, test: false }; savePrefs(uid, game, p); }
  const canModal = !i.isModalSubmit();

  if (isUnset(p)) {
    if (canModal) { await (i as ButtonInteraction).showModal(betMixModal(i as ButtonInteraction, `t:${game}:amtbet`, `${game.toUpperCase()} — BET 金額`, p)); return null; }
    await refresh(i, game, 'BET 額を設定してください (金額変更)');
    return null;
  }
  if (game === 'roulette' && p.opt === 'number') {
    if (canModal) { await (i as ButtonInteraction).showModal(numberModal('t:roulette:numbet')); return null; }
    await refresh(i, game, '数字を選んでください (掛け方 → Single Number)');
    return null;
  }

  await ack(i);
  const test = p.test;
  const bet = test ? TEST_BET : p.pp + p.ltc;
  const lim = BET_LIMITS[game];
  if (bet < lim.min || bet > lim.max) {
    await refresh(i, game, `BET は ¥${lim.min.toLocaleString()} 〜 ¥${lim.max.toLocaleString()} です (今: ¥${bet.toLocaleString()})`);
    return null;
  }
  if (!test) {
    const r = getReserves(uid);
    if (p.pp > r.pp)   { await refresh(i, game, `PayPay 由来が足りません (BET ¥${p.pp.toLocaleString()} / 保有 ¥${r.pp.toLocaleString()})。入金するか金額を変えてください`); return null; }
    if (p.ltc > r.ltc) { await refresh(i, game, `LTC 由来が足りません (BET ¥${p.ltc.toLocaleString()} / 保有 ¥${r.ltc.toLocaleString()})。入金するか金額を変えてください`); return null; }
  }
  return { uid, game, p, bet, mix: test ? undefined : { pp: p.pp, ltc: p.ltc }, test };
}

async function onBet(i: TI, game: Game) {
  const k = key(i.user.id, game);
  if (busy.has(k)) { await ack(i).catch(() => {}); return; }
  busy.add(k);
  try {
    if (game === 'craps') { await ack(i); return openCrapsTable(i); }
    if (game === 'mines') {
      // 進行中のゲームがあれば、新しく BET せずにその続きを出す
      const active = activeMines(i.user.id);
      if (active) { await ack(i); return renderMines(i, active, '進行中のゲームの続きです'); }
    }
    const round = await prepareRound(i, game);
    if (!round) return;
    if (!round.test) applyMix(round.uid, -round.mix!.pp, -round.mix!.ltc, `bet:${game}`);
    switch (game) {
      case 'blackjack':  return await playBlackjack(i, round);
      case 'slots':      return await playSlots(i, round);
      case 'roulette':   return await playRoulette(i, round);
      case 'baccarat':   return await playBaccarat(i, round);
      case 'videopoker': return await playVideoPoker(i, round);
      case 'mines':      return await playMines(i, round);
    }
  } finally {
    busy.delete(k);
  }
}

/* ────────────── SLOTS ────────────── */

async function playSlots(i: TI, r: Round) {
  // ① BET 受付と同じ同期ブロックで、cap 読み・出目決定・予約まで全部終わらせる
  //   (ここまで `await` を挟まない。JS single-thread で他のユーザーの BET と直列化される)
  const sid = r.test ? null : `s:slots:${randomUUID()}`;
  const cap = capForSync(r.test, undefined);
  const result = spinWithCap(r.bet, cap);
  const gross = r.bet * result.payoutMult;
  const payout = Math.min(gross, cap);
  if (sid && payout > 0) setCrapsExposure(sid, payout);

  // ② 演出 (結果は既に確定しているので、ここは見た目だけ)
  const strips = [reelStrip(result.reels[0], 8), reelStrip(result.reels[1], 10), reelStrip(result.reels[2], 12)];
  const frames: [number, number, number][] = [
    [0, 0, 0],
    [3, 5, 7],
    [strips[0].length - 1, 7, 9],
    [strips[0].length - 1, strips[1].length - 1, strips[2].length - 1],
  ];
  for (let f = 0; f < frames.length; f++) {
    const spinning = f < frames.length - 1;
    // ③ 最終コマを出す直前に credit (残高表示が今までと同じタイミングで更新される)
    if (!spinning && !r.test && payout > 0) {
      credit(r.uid, payout, r.mix, 'win:slots');
      if (sid) clearCrapsExposure(sid);
    }
    const reels = frames[f].map((idx, n) => strips[n][idx]) as typeof result.reels;
    const label = !spinning && result.payoutMult >= 200
      ? (result.payoutMult >= 2000 ? L('JACKPOT') : `${L('BIG')} ${L('WIN')}`)
      : (!spinning && result.payoutMult > 0 ? L('WIN') : undefined);
    const board = formatSlots({ reels, bet: r.bet, payoutMult: spinning ? 0 : result.payoutMult, spinning, label });
    const res = spinning ? undefined : resultLine(r.bet, payout);
    await show(i, { game: 'slots', uid: r.uid, prefs: r.p, test: r.test, board, result: res?.text, color: res?.color, inRound: spinning });
    if (spinning) await new Promise(ok => setTimeout(ok, 650));
  }
  await settled(i, 'slots', r.bet, payout, r.test, { mix: r.mix, detail: result.reels.map(slotEmoji).join(' ') });
}

/* ────────────── ROULETTE ────────────── */

async function playRoulette(i: TI, r: Round) {
  const [k, n] = r.p.opt.split(':');
  const kind = k as RouKind;
  const number = kind === 'number' ? Number(n) : undefined;
  const bet = { kind, amount: r.bet, number };
  // ① atomic に決定 & 予約
  const sid = r.test ? null : `s:rou:${randomUUID()}`;
  const cap = capForSync(r.test, undefined);
  const result = spinRouletteWithCap(bet, cap);
  const mult = rouPayout(bet, result);
  const payout = mult > 0 ? Math.min(r.bet * mult, cap) : 0;
  if (sid && payout > 0) setCrapsExposure(sid, payout);
  const betLabel = kind === 'number' ? `Single Number ${number}` : (ROU_LABEL[kind] ?? kind);

  // ② 演出
  const spinBoard = formatRoulette({ resultNumber: result, spinning: true, betLabel, betAmount: r.bet, payoutMult: 0 });
  await show(i, { game: 'roulette', uid: r.uid, prefs: r.p, test: r.test, board: spinBoard, inRound: true });
  await new Promise(ok => setTimeout(ok, 900));

  // ③ credit + 予約解放
  if (!r.test && payout > 0) {
    credit(r.uid, payout, r.mix, 'win:roulette');
    if (sid) clearCrapsExposure(sid);
  }
  const board = formatRoulette({ resultNumber: result, spinning: false, betLabel, betAmount: r.bet, payoutMult: mult });
  const res = resultLine(r.bet, payout);
  await show(i, { game: 'roulette', uid: r.uid, prefs: r.p, test: r.test, board, result: res.text, color: res.color });
  await settled(i, 'roulette', r.bet, payout, r.test, { mix: r.mix, detail: `${betLabel} — ${result} が出た` });
}

/* ────────────── BACCARAT ────────────── */

async function playBaccarat(i: TI, r: Round) {
  const side = (BAC_SIDES.some(([s]) => s === r.p.opt) ? r.p.opt : 'player') as BacSide;
  // 演出なし → 決定 & credit を同じ同期ブロックで (予約は不要)
  const cap = capForSync(r.test, undefined);
  const d = dealBaccaratWithCap(side, r.bet, cap);
  const mult = bacPayout(side, d.winner);
  const payout = mult > 0 ? Math.min(Math.floor(r.bet * mult), cap) : 0;
  if (!r.test && payout > 0) credit(r.uid, payout, r.mix, 'win:baccarat');
  const board = formatBaccarat({
    player: d.player, banker: d.banker, winner: d.winner,
    playerTotal: d.playerTotal, bankerTotal: d.bankerTotal, side, bet: r.bet, payout,
  });
  const res = resultLine(r.bet, payout);
  await show(i, { game: 'baccarat', uid: r.uid, prefs: r.p, test: r.test, board, result: res.text, color: res.color });
  if (mult > 1) await settled(i, 'baccarat', r.bet, payout, r.test, { mix: r.mix, detail: `${BAC_SIDES.find(([s]) => s === side)?.[1] ?? side} に BET` });
}

/* ────────────── BLACKJACK ────────────── */

/** BJ セッションが運営に対して負いうる最大額 (今の全ハンドの合計 bet × 2.5)。
 *  2.5 は Natural BJ の倍率。double / split で bet が増えれば自動で広がる。 */
function bjReservation(st: BJState): number {
  return Math.ceil(st.bets.reduce((s, b) => s + b, 0) * 2.5);
}

async function playBlackjack(i: TI, r: Round) {
  const st = startHand(r.bet, newShoe());
  const entry = sessions.create(r.uid, 'blackjack', st, r.bet, r.mix, r.test);
  // BET 受付の瞬間に、このセッションが払う可能性のある最大額を予約 (他ユーザーの cap から引かれる)
  if (!r.test) setCrapsExposure(entry.id, bjReservation(st));
  if (isBlackjack(st.player[0]) || isBlackjack(st.dealer)) {
    const dealerBJ = isBlackjack(st.dealer), playerBJ = isBlackjack(st.player[0]);
    if (playerBJ && dealerBJ) { st.results = ['push']; st.payout = r.bet; }
    else if (playerBJ) { st.results = ['bj']; st.payout = Math.floor(r.bet * 2.5); }
    else { st.results = ['lose']; st.payout = 0; }
    st.phase = 'done';
  }
  await renderBlackjack(i, entry.id, st);
}

/** bj:act:<hit|stand|double|split> */
export async function onBlackjackAction(i: ButtonInteraction, action: 'hit' | 'stand' | 'double' | 'split') {
  assertNotBanned(i.user.id);
  const sid = sidOf(i);
  const entry = sid ? sessions.get(sid) : undefined;
  if (!entry || entry.discordId !== i.user.id) return i.reply({ content: 'この手は終了しています。BET で次のゲームを始めてください', flags: MessageFlags.Ephemeral });
  // サーバー側の合法手検証: UI 側だけでなく、現在のハンド状態から見ても合法な action のみ許可する。
  // 古い (差し替え前の) ボタンの再発火や、他クライアントからの不正 action で split / double を悪用されないため。
  const st0 = entry.state as BJState;
  if (!availableActions(st0).includes(action)) {
    return i.reply({ content: 'このアクションは今は取れません', flags: MessageFlags.Ephemeral });
  }
  const k = key(i.user.id, 'blackjack');
  if (busy.has(k)) return i.deferUpdate().catch(() => {});
  busy.add(k);
  try {
    const st = entry.state as BJState;
    if (!entry.test && (action === 'double' || action === 'split')) {
      const addl = st.bets[st.active];
      if (getBalance(i.user.id) < addl) return i.reply({ content: `残高不足 (必要: ¥${addl.toLocaleString()})`, flags: MessageFlags.Ephemeral });
      if (entry.mix) {
        // 元の BET と同じ比率で追加分を引き落とす
        const total = entry.mix.pp + entry.mix.ltc;
        const ppAdd = total > 0 ? Math.floor(addl * entry.mix.pp / total) : addl;
        const ltcAdd = addl - ppAdd;
        const res = getReserves(i.user.id);
        if (ppAdd > res.pp || ltcAdd > res.ltc) return i.reply({ content: '同じ比率で追加 BET する残高が足りません', flags: MessageFlags.Ephemeral });
        applyMix(i.user.id, -ppAdd, -ltcAdd, `bet:blackjack:${action}`, sid!);
        entry.mix = { pp: entry.mix.pp + ppAdd, ltc: entry.mix.ltc + ltcAdd };
      } else {
        txCredit(i.user.id, -addl, `bet:blackjack:${action}`, sid!);
      }
    }
    // double / split で bet が増えたら、同じ同期ブロックで予約も広げる
    if (!entry.test) setCrapsExposure(entry.id, bjReservation(st));
    await ack(i);
    // settleDealer の reshuffle には "自分の予約は無視した cap" を渡す (自分の分の余力を使い切っていい)
    apply(st, action, capForSync(!!entry.test, entry.id));
    await renderBlackjack(i, entry.id, st);
  } finally {
    busy.delete(k);
  }
}

async function renderBlackjack(i: TI, sid: string, st: BJState) {
  const entry = sessions.get(sid)!;
  const test = !!entry.test;
  const uid = i.user.id;
  const p = getPrefs(uid, 'blackjack');
  const done = st.phase === 'done';
  const totalBet = st.bets.reduce((a, b) => a + b, 0);

  // 払戻しを先に済ませてから描く (残高の表示を正しくするため)
  if (done) {
    if (!test) {
      // 最後の保険: settleDealer が reshuffle で収まり切らなかった場合に備え、
      // 自分の予約を外した状態での cap で silent にクランプする。
      // 画面の役 / results は変えず、金額だけ削る (user には "引きが弱かった" に見える)。
      const cap = housePayoutCapSync(sid);
      if ((st.payout ?? 0) > cap) st.payout = Math.max(0, cap);
      credit(uid, st.payout ?? 0, entry.mix, 'win:blackjack', sid);
      clearCrapsExposure(sid);
    }
    sessions.drop(sid);
  } else {
    sessions.save(sid);
  }

  const board = formatBlackjack({
    player: st.player, active: st.active, dealer: st.dealer, hideHole: st.phase === 'player',
    bets: st.bets, balance: getBalance(uid), phase: st.phase, results: st.results, payout: st.payout,
  });
  if (done) {
    const res = resultLine(totalBet, st.payout ?? 0);
    await show(i, { game: 'blackjack', uid, prefs: p, test, board, result: res.text, color: res.color });
    const bjLabel: Record<string, string> = { bj: 'BLACKJACK', win: 'WIN', push: 'PUSH', lose: 'LOSE' };
    await settled(i, 'blackjack', totalBet, st.payout ?? 0, test, {
      mix: entry.mix, detail: (st.results ?? []).map(x => bjLabel[x] ?? x).join(' / ') + (st.player.length > 1 ? ` (${st.player.length} ハンド)` : ''),
    });
    return;
  }
  await show(i, {
    game: 'blackjack', uid, prefs: p, test, board, sid, inRound: true,
    result: `あなたの番 — hand ${st.active + 1}/${st.player.length}`,
    actions: [bjActionsRow(availableActions(st), sid)],
  });
}

/* ────────────── VIDEO POKER ────────────── */

function vpHoldButtons(st: VPHand, sid: string): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  st.cards.forEach((c, idx) => {
    const state = st.held[idx] ? 'HELD' : 'HOLD';
    const btn = new ButtonBuilder().setCustomId(`vp:hold:${idx}:${sid}`)
      .setStyle(st.held[idx] ? ButtonStyle.Primary : ButtonStyle.Secondary);
    const e = cardButtonEmoji(c);
    if (e) btn.setEmoji(e).setLabel(state);
    else btn.setLabel(`${cardText(c)} ${state}`);
    row.addComponents(btn);
  });
  return row;
}

async function playVideoPoker(i: TI, r: Round) {
  const st = startVP();
  const entry = sessions.create(r.uid, 'videopoker', st, r.bet, r.mix, r.test);
  // BET 時点で Royal Flush (×800) までの払戻しを予約
  if (!r.test) setCrapsExposure(entry.id, r.bet * MAX_GROSS_MULT.videopoker);
  await renderVideoPoker(i, entry.id, st);
}

/** vp:hold:<n> / vp:draw */
export async function onVideoPokerAction(i: ButtonInteraction, action: 'hold' | 'draw', arg?: string) {
  assertNotBanned(i.user.id);
  const sid = sidOf(i);
  const entry = sid ? sessions.get(sid) : undefined;
  if (!entry || entry.discordId !== i.user.id) return i.reply({ content: 'この手は終了しています。BET で次のゲームを始めてください', flags: MessageFlags.Ephemeral });
  const st = entry.state as VPHand;
  if (action === 'hold') {
    const idx = Number(arg);
    if (!Number.isInteger(idx) || idx < 0 || idx > 4) return i.reply({ content: '不正な HOLD 指定', flags: MessageFlags.Ephemeral });
    if (st.phase === 'deal') st.held[idx] = !st.held[idx];
    await ack(i);
    return renderVideoPoker(i, sid!, st);
  }
  const k = key(i.user.id, 'videopoker');
  if (busy.has(k)) return i.deferUpdate().catch(() => {});
  busy.add(k);
  try {
    // DRAW は "cap 読み → 役決定 → クランプ" を atomic に。await は結果を描画する段で入れる
    if (st.phase === 'deal') drawVPWithCap(st, entry.bet, capForSync(!!entry.test, sid!));
    await ack(i);
    await renderVideoPoker(i, sid!, st);
  } finally {
    busy.delete(k);
  }
}

async function renderVideoPoker(i: TI, sid: string, st: VPHand) {
  const entry = sessions.get(sid)!;
  const test = !!entry.test;
  const uid = i.user.id;
  const p = getPrefs(uid, 'videopoker');
  const mult = st.rank ? payoutFor(st.rank) : 0;
  const rankLabel = st.rank ? (VP_RANK_LABEL[st.rank] ?? st.rank) : undefined;
  const board = formatVideoPoker({ hand: st, bet: entry.bet, phase: st.phase, rankLabel, payoutMult: mult });

  if (st.phase === 'drawn') {
    let payout = 0;
    if (mult > 0) {
      payout = test ? Math.floor(entry.bet * mult) : Math.min(Math.floor(entry.bet * mult), housePayoutCapSync(sid));
      if (!test) credit(uid, payout, entry.mix, 'win:videopoker', sid);
    }
    if (!test) clearCrapsExposure(sid);
    sessions.drop(sid);
    const res = resultLine(entry.bet, payout);
    await show(i, { game: 'videopoker', uid, prefs: p, test, board, result: `${rankLabel ? `**${rankLabel}**  ` : ''}${res.text}`, color: res.color });
    await settled(i, 'videopoker', entry.bet, payout, test, { mix: entry.mix, detail: rankLabel });
    return;
  }
  sessions.save(sid);
  await show(i, {
    game: 'videopoker', uid, prefs: p, test, board, sid, inRound: true,
    result: '残すカードを HOLD して DRAW',
    actions: [vpHoldButtons(st, sid)],
    primary: new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`vp:draw:${sid}`).setLabel('DRAW').setStyle(ButtonStyle.Primary)),
  });
}

/* ────────────── MINES (マインスイーパー) ────────────── */

const MN = {
  tile: () => emoji('mines_tile') || '▫️',
  gem:  () => emoji('mines_gem')  || '◆',
  bomb: () => emoji('mines_bomb') || '✖',
};

/** 本人の進行中のマインスイーパー (あれば) */
function activeMines(uid: string): string | null {
  return sessions.listByUser(uid).find(e => e.game === 'mines' && (e.state as MinesState).phase === 'play')?.id ?? null;
}

/** 盤面の絵文字。終わったら爆弾の位置も見せる。 */
function minesGrid(st: MinesState): string {
  const done = st.phase !== 'play';
  const lines: string[] = [];
  for (let r = 0; r < st.size; r++) {
    const cells: string[] = [];
    for (let c = 0; c < st.size; c++) {
      const k = r * st.size + c;
      // 終わったら爆弾をすべて見せる。開けた宝石は宝石、開けなかったマスは伏せたまま
      cells.push(st.bombs[k] && (done || st.opened[k]) ? MN.bomb() : st.opened[k] ? MN.gem() : MN.tile());
    }
    // 見出しの行は上下の間隔が広いので、横にも同じくらいの空白 (全角幅 + 半角幅 + 細い空白) を入れて正方形に見せる
    lines.push(`### ${cells.join('\u2003\u2002\u2009')}`);
  }
  return lines.join('\n');
}

/** 宝石を全部開けたときの払戻し (このゲームで払う可能性がある最大額) */
const minesMaxPayout = (st: MinesState, bet: number) => minesPayout(bet, st.size, st.mines, safeCount(st));

async function playMines(i: TI, r: Round) {
  const { size, mines } = minesOpt(r.p.opt);
  const st = newMines(size, mines);
  const entry = sessions.create(r.uid, 'mines', st, r.bet, r.mix, r.test);
  if (!r.test) {
    // 上限は BET の時点で判断する。最大額が運営の払える額に収まらなければ始めずに返金し、
    // 収まればその額を最後まで確保しておく (ゲームの途中で止まることはない)
    const cap = housePayoutCapSync(entry.id);
    if (minesMaxPayout(st, r.bet) > cap) {
      sessions.drop(entry.id);
      credit(r.uid, r.bet, r.mix, 'refund:mines:cap');
      const maxBet = Math.floor(cap / minesMult(size, mines, safeCount(st)));
      return refresh(i, 'mines', maxBet >= BET_LIMITS.mines.min
        ? `${size}×${size}・爆弾 ${mines} 個の BET は ¥${maxBet.toLocaleString()} までです。BET 額を変えるか、爆弾の数を減らしてください`
        : `今は ${size}×${size}・爆弾 ${mines} 個では遊べません。爆弾の数を減らしてください`);
    }
    setCrapsExposure(entry.id, minesMaxPayout(st, r.bet));
  }
  await renderMines(i, entry.id);
}

/** mn:open:<マス>:<sid> / mn:cash:<sid> */
export async function onMinesAction(i: ButtonInteraction, action: 'open' | 'cash', arg?: string) {
  assertNotBanned(i.user.id);
  const sid = sidOf(i);
  const entry = sid ? sessions.get(sid) : undefined;
  if (!entry || entry.discordId !== i.user.id || entry.game !== 'mines') {
    return i.reply({ content: 'このゲームは終了しています。BET で次のゲームを始めてください', flags: MessageFlags.Ephemeral });
  }
  const k = key(i.user.id, 'mines');
  if (busy.has(k)) return i.deferUpdate().catch(() => {});
  busy.add(k);
  try {
    await ack(i);
    const st = entry.state as MinesState;
    const test = !!entry.test;
    if (st.phase !== 'play') return renderMines(i, sid!);
    if (action === 'open') {
      const cell = Number(arg);
      if (!Number.isInteger(cell)) return renderMines(i, sid!);
      const res = openCell(st, cell);
      if (res === 'safe' && openedCount(st) >= safeCount(st)) st.phase = 'cashed';   // 宝石を全部開けたら自動で CASH OUT
      return renderMines(i, sid!);
    }
    if (openedCount(st) === 0) return renderMines(i, sid!, '1 マス以上開けてから CASH OUT できます');
    st.phase = 'cashed';
    return renderMines(i, sid!);
  } finally {
    busy.delete(k);
  }
}

async function renderMines(i: TI, sid: string, notice?: string) {
  const entry = sessions.get(sid)!;
  const st = entry.state as MinesState;
  const test = !!entry.test;
  const uid = i.user.id;
  const p = getPrefs(uid, 'mines');
  const k = openedCount(st);
  const head = `**${st.size}×${st.size} / 爆弾 ${st.mines}** — 開けた宝石 ${k} / ${safeCount(st)}`;

  if (st.phase !== 'play') {
    // 払戻しを先に済ませてから描く (残高の表示を正しくするため)
    let payout = 0;
    if (st.phase === 'cashed') {
      payout = minesPayout(entry.bet, st.size, st.mines, k);
      if (!test) { payout = clampPayoutSync(payout, sid); credit(uid, payout, entry.mix, 'win:mines', sid); }
    }
    clearCrapsExposure(sid);
    sessions.drop(sid);
    const res = resultLine(entry.bet, payout);
    const what = st.phase === 'bust' ? `**${MN.bomb()} 爆弾**` : `**CASH OUT ×${minesMult(st.size, st.mines, k)}**`;
    await show(i, { game: 'mines', uid, prefs: p, test, board: `${minesGrid(st)}\n${head}`, result: `${what}  ${res.text}`, color: res.color });
    await settled(i, 'mines', entry.bet, payout, test, { mix: entry.mix, detail: `${st.size}×${st.size}・爆弾 ${st.mines} 個 — 宝石 ${k} 個で CASH OUT ×${minesMult(st.size, st.mines, k)}` });
    return;
  }

  sessions.save(sid);
  const now = minesMult(st.size, st.mines, k);
  const next = k < safeCount(st) ? minesMult(st.size, st.mines, k + 1) : null;
  const lines = [
    head,
    k > 0 ? `今 **×${now}** (CASH OUT で ¥${minesPayout(entry.bet, st.size, st.mines, k).toLocaleString()})` : '最初のマスを選んでください',
    next !== null ? `次のマス **×${next}** (¥${minesPayout(entry.bet, st.size, st.mines, k + 1).toLocaleString()})` : '',
  ].filter(Boolean);

  const grid: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let r = 0; r < st.size; r++) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (let c = 0; c < st.size; c++) {
      const cell = r * st.size + c;
      const opened = st.opened[cell];
      const b = new ButtonBuilder().setCustomId(`mn:open:${cell}:${sid}`).setStyle(ButtonStyle.Secondary).setDisabled(opened);
      const ref = emojiRef(opened ? 'mines_gem' : 'mines_tile');
      if (ref) b.setEmoji(ref); else b.setLabel(opened ? '◆' : '?');
      row.addComponents(b);
    }
    grid.push(row);
  }
  const cashLabel = k > 0 ? `CASH OUT ¥${minesPayout(entry.bet, st.size, st.mines, k).toLocaleString()}` : 'CASH OUT';
  await show(i, {
    game: 'mines', uid, prefs: p, test, sid, inRound: true, bare: true,
    board: lines.join('\n'),
    notice,
    actions: grid,
    primary: new ActionRowBuilder<ButtonBuilder>().addComponents(
      withEmoji(new ButtonBuilder().setCustomId(`mn:cash:${sid}`).setLabel(cashLabel).setStyle(ButtonStyle.Primary).setDisabled(k === 0), 'ui_chip')),
  });
}

/* ────────────── CRAPS ────────────── */

/** 盤面のすぐ下に出す、ワンタップの賭け (今の BET 額でそのまま台に置く) */
const CRAPS_QUICK: Record<'comeout' | 'point', Array<[CrapsBetKind, string]>> = {
  comeout: [['pass', 'PASS'], ['dontpass', "DON'T PASS"], ['field', 'FIELD'], ['any7', 'ANY 7']],
  point:   [['pass_odds', 'ODDS'], ['come', 'COME'], ['dontcome', "DON'T COME"], ['field', 'FIELD']],
};
const isCrapsKind = (s: string): s is CrapsBetKind => CRAPS_KINDS.some(([k]) => k === s);

/** 再起動したときの返金に使う保存データを、台の上の BET に合わせる */
function syncCrapsEntry(entry: NonNullable<ReturnType<typeof sessions.get>>, st: CrapsState) {
  const stake = st.bets.reduce((n, b) => n + b.amount, 0);
  entry.bet = entry.test ? 0 : stake;
  entry.mix = entry.test || stake === 0 || !st.bets.every(b => b.mix) ? undefined
    : st.bets.reduce((m, b) => ({ pp: m.pp + b.mix!.pp, ltc: m.ltc + b.mix!.ltc }), { pp: 0, ltc: 0 });
}

/** 外した BET を、置いたときの PayPay / LTC の内訳のまま戻す */
function refundCrapsBet(uid: string, sid: string, b: CrapsBet, reason: string) {
  if (b.mix) applyMix(uid, b.mix.pp, b.mix.ltc, reason, sid);
  else txCredit(uid, b.amount, reason, sid);
}

function crapsBetLine(b: CrapsBet): string {
  return `\`#${b.id}\` ${crapsName(b.kind)}${b.point ? ` (${b.point})` : ''} **¥${b.amount.toLocaleString()}**${isLocked(b) ? '  _確定_' : ''}`;
}

function crapsView(uid: string, sid: string, st: CrapsState, notice?: string, rolling?: [number, number]): View {
  const entry = sessions.get(sid);
  const p = getPrefs(uid, 'craps');
  const header = st.phase === 'comeout'
    ? '**COME OUT** — 7/11 勝ち / 2/3/12 クラップス / 4-10 point 成立'
    : `**POINT ${st.point}** — ${st.point} 再出で Pass 勝ち / 7 で Seven-Out`;
  const dice = rolling ?? st.lastRoll;
  const board = dice ? `${crapsDiceLine(dice[0], dice[1])}\n${rolling ? `**${L('ROLLING')}…**` : header}` : header;

  // 直近の ROLL の結果。ほかのゲームと同じ WIN / LOSE / PUSH の行に、BET ごとの結果を添える
  let result: string | undefined;
  let color: number = st.phase === 'comeout' ? COLOR.violet : COLOR.purple;
  const lr = rolling ? undefined : st.lastResult;
  if (lr && st.lastRoll) {
    const head = `**${st.lastRoll[0] + st.lastRoll[1]}**`;
    if (lr.resolved > 0 || lr.payout > 0) {
      const res = resultLine(lr.wager, lr.payout);
      color = res.color;
      result = [`${head}  ${res.text}`, ...lr.lines].join('\n');
    } else {
      result = [`${head}  **決着なし** — BET は台に残っています`, ...lr.lines].join('\n');
    }
  }

  const stake = st.bets.reduce((n, b) => n + b.amount, 0);
  const betsText = st.bets.length
    ? st.bets.slice(-10).map(crapsBetLine).join('\n') + (st.bets.length > 10 ? `\n…他${st.bets.length - 10}件` : '')
    : '_ベットなし_';
  const hist = st.history.length ? st.history.slice(-5).join('\n') : '_まだ振られていません_';
  const net = st.totalReturned - (st.totalWagered - stake);
  const canUndo = st.bets.some(b => !isLocked(b));

  return {
    // 台に賭けが載っていれば台の状態 (テスト/本番) を、空の台なら次に賭けるときの設定を表示する
    game: 'craps', uid, prefs: p, sid, notice, board, result, color, phase: st.phase, inRound: !!rolling,
    test: st.totalWagered > 0 || st.bets.length > 0 ? !!entry?.test : undefined,
    fields: [
      { name: `台の上のベット (${st.bets.length})${stake ? `  ¥${stake.toLocaleString()}` : ''}`, value: betsText.slice(0, 1024) },
      { name: '直近の振り', value: hist.slice(-1000) },
      { name: 'この台の累計', value: `${signedYen(net)} (賭 ¥${(st.totalWagered - stake).toLocaleString()} / 戻 ¥${st.totalReturned.toLocaleString()})` },
    ],
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      CRAPS_QUICK[st.phase].map(([k, label]) => new ButtonBuilder()
        .setCustomId(`cr:q:${k}:${sid}`).setLabel(L(label)).setStyle(ButtonStyle.Secondary).setDisabled(!!rolling)))],
    primary: new ActionRowBuilder<ButtonBuilder>().addComponents(
      withEmoji(new ButtonBuilder().setCustomId(`cr:roll:${sid}`).setLabel(L('ROLL')).setStyle(ButtonStyle.Primary).setDisabled(!!rolling || st.bets.length === 0), 'game_craps'),
      new ButtonBuilder().setCustomId(`cr:undo:${sid}`).setLabel('直前のベット取消').setStyle(ButtonStyle.Secondary).setDisabled(!!rolling || !canUndo),
      new ButtonBuilder().setCustomId(`cr:clear:${sid}`).setLabel('すべて外す').setStyle(ButtonStyle.Secondary).setDisabled(!!rolling || !canUndo),
      new ButtonBuilder().setCustomId(`cr:end:${sid}`).setLabel('END').setStyle(ButtonStyle.Secondary).setDisabled(!!rolling),
    ),
  };
}

/** 本人の進行中の台 (あれば) */
function activeCraps(uid: string): string | null {
  return sessions.listByUser(uid).find(e => e.game === 'craps')?.id ?? null;
}

/** クラップスの台を開く (ack 済みの前提)。進行中の台があれば、新しく作らずその続きを出す。 */
async function openCrapsTable(i: TI, notice?: string) {
  const live = activeCraps(i.user.id);
  if (live) {
    const st = sessions.get(live)!.state as CrapsState;
    return show(i, crapsView(i.user.id, live, st, notice ?? (st.bets.length ? '進行中の台の続きです' : undefined)));
  }
  return openFreshCrapsTable(i, notice);
}

async function openFreshCrapsTable(i: TI, notice?: string) {
  const st = newCraps();
  const entry = sessions.create(i.user.id, 'craps', st, 0);
  setCrapsExposure(entry.id, 0);
  return show(i, crapsView(i.user.id, entry.id, st, notice));
}

/** 賭けの種類を選ぶ / クイック BET を押したら、今の BET 額でその場に置く。 */
async function onCrapsAdd(i: TI, kind: CrapsBetKind) {
  const uid = i.user.id;
  let p = getPrefs(uid, 'craps');
  if (p.test && !canTestPlay(i)) { p = { ...p, test: false }; savePrefs(uid, 'craps', p); }
  if (isUnset(p)) {
    if (!i.isModalSubmit()) return i.showModal(betMixModal(i, `t:craps:amtadd:${kind}${sidOf(i) ? `:${sidOf(i)}` : ''}`, `${L('CRAPS')} — BET 金額`, p));
    return refresh(i, 'craps', 'BET 額を設定してください (金額変更)');
  }
  await ack(i);
  const sid = sidOf(i);
  const entry = sid ? sessions.get(sid) : undefined;
  if (!entry || entry.discordId !== uid || entry.game !== 'craps') return openCrapsTable(i, '台が見つからなかったので台を開き直しました。もう一度賭けの種類を選んでください');
  if (busy.has(key(uid, 'craps'))) return;                // ROLL 中は受けない
  const st = entry.state as CrapsState;
  const test = p.test;
  const amount = test ? TEST_BET : p.pp + p.ltc;
  const lim = BET_LIMITS.craps;
  const fail = (msg: string) => show(i, crapsView(uid, sid!, st, msg));

  if (amount < lim.min || amount > lim.max) return fail(`BET は ¥${lim.min.toLocaleString()} 〜 ¥${lim.max.toLocaleString()} です`);
  if ((st.totalWagered > 0 || st.bets.length > 0) && !!entry.test !== test) {
    return fail(entry.test
      ? 'この台はテストプレイ中です。本番で賭けるには END で台を閉じてください'
      : 'この台は本番です。テストプレイするには END で台を閉じてください');
  }
  if ((kind === 'pass_odds' || kind === 'dontpass_odds') && st.phase !== 'point') return fail('Odds はポイント確立後のみ');
  if ((kind === 'come' || kind === 'dontcome') && st.phase !== 'point') return fail("Come / Don't Come はポイント確立後のみ");
  if (kind === 'pass' && st.phase === 'point') return fail('Pass Line は come-out 時のみ (今は Come を使用)');
  if (kind === 'dontpass' && st.phase === 'point') return fail("Don't Pass は come-out 時のみ (今は Don't Come を使用)");
  if (!test) {
    const r = getReserves(uid);
    if (p.pp > r.pp)   return fail(`PayPay 由来が足りません (BET ¥${p.pp.toLocaleString()} / 保有 ¥${r.pp.toLocaleString()})`);
    if (p.ltc > r.ltc) return fail(`LTC 由来が足りません (BET ¥${p.ltc.toLocaleString()} / 保有 ¥${r.ltc.toLocaleString()})`);
  }

  entry.test = test;
  const mix = test ? undefined : { pp: p.pp, ltc: p.ltc };
  if (mix) applyMix(uid, -mix.pp, -mix.ltc, `bet:craps:${kind}`, sid!);
  addBet(st, kind, amount, mix);
  st.lastResult = undefined;
  if (!test) setCrapsExposure(sid!, openExposure(st));
  syncCrapsEntry(entry, st);
  sessions.save(sid!);
  return show(i, crapsView(uid, sid!, st));
}

/** cr:roll / cr:undo / cr:clear / cr:end / cr:q:<賭けの種類> */
export async function onCrapsAction(i: ButtonInteraction, action: 'roll' | 'undo' | 'clear' | 'end' | 'q', arg?: string) {
  assertNotBanned(i.user.id);
  const uid = i.user.id;
  if (action === 'q') {
    if (!arg || !isCrapsKind(arg)) { await i.deferUpdate().catch(() => {}); return; }
    return onCrapsAdd(i, arg);
  }
  const sid = sidOf(i);
  const entry = sid ? sessions.get(sid) : undefined;
  await ack(i);
  if (!entry || entry.discordId !== uid || entry.game !== 'craps') return openCrapsTable(i, '前の台は終了しています');
  const st = entry.state as CrapsState;
  const test = !!entry.test;
  const k = key(uid, 'craps');
  if (busy.has(k)) return;                                  // ROLL 中は他の操作を受けない
  const view = (notice?: string) => show(i, crapsView(uid, sid!, st, notice));
  const after = () => {
    if (!test) setCrapsExposure(sid!, openExposure(st));
    syncCrapsEntry(entry, st);
    sessions.save(sid!);
  };

  if (action === 'undo') {
    // 一番新しい、外せる BET を 1 つ戻す (振られた Pass / Come は確定なので戻さない)
    let idx = -1;
    for (let n = st.bets.length - 1; n >= 0; n--) if (!isLocked(st.bets[n])) { idx = n; break; }
    if (idx < 0) return view('戻せるベットがありません (振られた Pass / Come は決着まで外せません)');
    const [b] = st.bets.splice(idx, 1);
    if (!test) refundCrapsBet(uid, sid!, b, 'bet:craps:undo');
    st.totalWagered -= b.amount;
    st.lastResult = undefined;
    after();
    return view();
  }

  if (action === 'clear' || action === 'end') {
    const gone = st.bets.filter(b => !isLocked(b));
    st.bets = st.bets.filter(isLocked);
    for (const b of gone) { if (!test) refundCrapsBet(uid, sid!, b, 'bet:craps:takedown'); st.totalWagered -= b.amount; }
    const back = gone.reduce((n, b) => n + b.amount, 0);
    if (gone.length) st.lastResult = undefined;
    after();
    if (action === 'clear') {
      return view(gone.length ? `${gone.length} 件のベット (¥${back.toLocaleString()}) を外しました` : '外せるベットがありません (振られた Pass / Come は決着まで外せません)');
    }
    if (st.bets.length) return view('Pass / Come が決着するまで END できません。ROLL で決着させてください');
    clearCrapsExposure(sid!);
    sessions.drop(sid!);
    const net = st.totalReturned - st.totalWagered;
    return openFreshCrapsTable(i, `前の台の累計: ${signedYen(net)} (賭 ¥${st.totalWagered.toLocaleString()} / 戻 ¥${st.totalReturned.toLocaleString()})${back ? `。外したベット ¥${back.toLocaleString()} は返金済み` : ''}`);
  }

  // roll
  if (st.bets.length === 0) return view('ベットがありません');
  busy.add(k);
  try {
    // 転がる演出 (ほかのゲームの回転と同じく 2 コマ)
    for (let f = 0; f < 2; f++) {
      await show(i, crapsView(uid, sid!, st, undefined, [rollDie(), rollDie()]));
      await new Promise(ok => setTimeout(ok, 600));
    }

    const report = crapsRoll(st, capForSync(test, sid!));
    st.lastRoll = [report.d1, report.d2];
    let total = 0;
    const stay: CrapsBet[] = [];
    for (const r of report.resolutions) {
      if (r.payout > 0) total += r.payout;
      if (r.stay) {
        if (r.pointMoved) r.bet.point = r.pointMoved;
        r.bet.rolled = (r.bet.rolled ?? 0) + 1;
        stay.push(r.bet);
      }
    }
    st.bets = stay;
    if (report.phaseChange === 'pointSet') { st.phase = 'point'; st.point = report.newPoint; }
    if (report.phaseChange === 'pointHit' || report.phaseChange === 'seven_out') { st.phase = 'comeout'; st.point = undefined; }

    // 各ベットの払戻しは、そのベットを出した PayPay / LTC の比率で戻す
    const paid = new Map<number, number>();
    if (total > 0) {
      if (!test) {
        const raw = total;
        total = clampPayoutSync(raw, sid!);
        let remaining = total;
        const winners = report.resolutions.filter(r => r.payout > 0);
        winners.forEach((r, idx) => {
          const share = idx === winners.length - 1 ? remaining : Math.floor(r.payout * total / raw);
          remaining -= share;
          paid.set(r.bet.id, share);
          credit(uid, share, r.bet.mix, 'win:craps', sid!);
        });
      } else {
        for (const r of report.resolutions) if (r.payout > 0) paid.set(r.bet.id, r.payout);
      }
      st.totalReturned += total;
    }

    // BET ごとの結果 (決着したもの・ポイントが付いたもの)
    const lines: string[] = [];
    let wager = 0, resolved = 0;
    for (const r of report.resolutions) {
      const b = r.bet, got = paid.get(b.id) ?? 0;
      const name = `${crapsName(b.kind)}${b.point && !r.pointMoved ? ` (${b.point})` : ''} ¥${b.amount.toLocaleString()}`;
      if (!r.stay) {
        wager += b.amount; resolved++;
        if (got > b.amount)        lines.push(`${ICON.arrow()} ${name} — **WIN** +¥${(got - b.amount).toLocaleString()}`);
        else if (got === b.amount) lines.push(`${ICON.arrow()} ${name} — **PUSH**`);
        else                       lines.push(`${ICON.arrow()} ${name} — LOSE`);
      } else if (got > 0) {
        lines.push(`${ICON.arrow()} ${name} — **WIN** +¥${got.toLocaleString()} (BET は台に残ります)`);
      } else if (r.pointMoved) {
        lines.push(`${ICON.arrow()} ${name} — POINT ${r.pointMoved}`);
      }
    }
    st.lastResult = { lines: lines.length > 10 ? [...lines.slice(0, 10), `…他${lines.length - 10}件`] : lines, wager, payout: total, resolved };

    st.history.push(report.log);
    if (st.history.length > 20) st.history.shift();
    if (!test) setCrapsExposure(sid!, openExposure(st));
    syncCrapsEntry(entry, st);
    sessions.save(sid!);

    await show(i, crapsView(uid, sid!, st));
    const settledBets = report.resolutions.filter(r => !r.stay);
    const crapsMix = settledBets.length && settledBets.every(r => r.bet.mix)
      ? settledBets.reduce((m, r) => ({ pp: m.pp + r.bet.mix!.pp, ltc: m.ltc + r.bet.mix!.ltc }), { pp: 0, ltc: 0 }) : undefined;
    const wonKinds = [...new Set(report.resolutions.filter(r => r.payout > 0).map(r => crapsName(r.bet.kind)))];
    await settled(i, 'craps', wager, total, test, { mix: crapsMix, detail: `${report.d1 + report.d2} が出た — ${wonKinds.join(' / ')}` });
  } finally {
    busy.delete(k);
  }
}
