import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { L } from './leet.js';
import { MIN_DEPOSIT_JPY, MIN_WITHDRAW_JPY } from '../payments/limits.js';
import { renderBalance } from './render-balance.js';
import { formatRemaining, elapsedRatio } from '../mws/timer.js';
/**
 * リザルト画面 / 入金完了画面の [Replay] [入金] ボタン。
 * sub は前回の賭け方 (バカラのサイド、ルーレットの掛け方)。
 * どのゲームに戻るか (ctx = <game>[:<sub>]) を両方のボタンに埋め込んで持ち回る。
 */
export function replayRow(game, sub) {
    const ctx = `${game}${sub ? `:${sub}` : ''}`;
    return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`replay:${ctx}`).setLabel('Replay').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`dep:open:${ctx}`).setLabel('入金').setStyle(ButtonStyle.Success));
}
/** replayRow を ctx (<game>[:<sub>]) から作る。 */
export function replayRowFromCtx(ctx) {
    const [game, ...rest] = ctx.split(':');
    return replayRow(game, rest.join(':') || undefined);
}
export function leetPanel() {
    const embed = new EmbedBuilder()
        .setTitle('LEET 変換')
        .setColor(0x6b7280)
        .setDescription('入力したアルファベットをオリジナル LEET に変換します。\n' +
        '結果は投稿者本人にのみ表示されます (ephemeral)。')
        .setFooter({ text: '管理者用ツール' });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('leet:convert').setLabel('変換').setStyle(ButtonStyle.Primary));
    return { embeds: [embed], components: [row] };
}
/* ────────────── Per-game Play panels (mix bet 対応) ────────────── */
function bjPlayPanel() {
    const embed = new EmbedBuilder()
        .setTitle(L('BLACKJACK'))
        .setColor(0x0d5a3a)
        .setDescription('6 デッキシューで Dealer soft 17 Hit (H17)、Blackjack 配当 **3:2**。\n' +
        'Double / Split (最大 4 ハンド) 対応。')
        .addFields({ name: 'ルール', value: '・Blackjack (A + 10 点札) で即勝ち 3:2\n' +
            '・Dealer は 17 以上まで Hit (soft 17 も Hit)\n' +
            '・Split した A は 1 枚ずつのみ Hit 可\n' +
            '・Double は最初の 2 枚のみ',
        inline: false }, { name: '最小 / 最大 BET', value: '`10` / `50,000` chips', inline: true }, { name: 'ハウスエッジ', value: '約 0.6%', inline: true })
        .setFooter({ text: 'Play を押して BET 額を入力' });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('play:blackjack').setLabel('Play').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('bal').setLabel('残高確認').setStyle(ButtonStyle.Secondary));
    return { embeds: [embed], components: [row] };
}
function slotsPlayPanel() {
    const embed = new EmbedBuilder()
        .setTitle(L('SLOTS'))
        .setColor(0x7c2d12)
        .setDescription('3 リール 8 シンボルの古典型スロット。各リールが独立に停止します。')
        .addFields({ name: '配当', value: '・3-of-a-kind: シンボル固有倍率 (5x〜200x)\n' +
            '・2 連 🍒: 2x サイド配当',
        inline: false }, { name: '最小 / 最大 BET', value: '`10` / `10,000` chips', inline: true }, { name: 'RTP (目安)', value: '94〜96%', inline: true })
        .setFooter({ text: 'Play を押して BET 額を入力' });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('play:slots').setLabel('Play').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('bal').setLabel('残高確認').setStyle(ButtonStyle.Secondary));
    return { embeds: [embed], components: [row] };
}
function vpPlayPanel() {
    const embed = new EmbedBuilder()
        .setTitle(L('VIDEO POKER'))
        .setColor(0x1e3a8a)
        .setDescription('Jacks or Better 9/6 配当表。最初に 5 枚配られ、Hold したいカードを選んで Draw。')
        .addFields({ name: '配当 (BET=1 基準)', value: 'Royal 800 / Straight Flush 50 / 4-of-a-kind 25\n' +
            'Full House 9 / Flush 6 / Straight 4 / 3-of-a-kind 3\n' +
            'Two Pair 2 / Jacks or Better 1',
        inline: false }, { name: '最小 / 最大 BET', value: '`10` / `50,000` chips', inline: true }, { name: 'RTP (完璧プレイ)', value: '約 99.5%', inline: true })
        .setFooter({ text: 'Play を押して BET 額を入力' });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('play:videopoker').setLabel('Play').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('bal').setLabel('残高確認').setStyle(ButtonStyle.Secondary));
    return { embeds: [embed], components: [row] };
}
function roulettePlayPanel() {
    const embed = new EmbedBuilder()
        .setTitle(L('ROULETTE'))
        .setColor(0x991b1b)
        .setDescription('シングルゼロ (ヨーロピアン)。テーブルで掛け方を選んで BET。')
        .addFields({ name: '配当', value: '・Straight (1 数字) **35:1**\n' +
            '・Red / Black / Odd / Even / Low / High **1:1**\n' +
            '・Dozen / Column **2:1**',
        inline: false }, { name: '最小 / 最大 BET', value: '`10` / `50,000` chips', inline: true }, { name: 'ハウスエッジ', value: '2.70% (0 の一枠)', inline: true })
        .setFooter({ text: '賭け方を押して BET 額を入力' });
    const row1 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('play:roulette:red').setLabel('Red').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('play:roulette:black').setLabel('Black').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('play:roulette:odd').setLabel('Odd').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('play:roulette:even').setLabel('Even').setStyle(ButtonStyle.Primary));
    const row2 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('play:roulette:low').setLabel('1-18').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('play:roulette:high').setLabel('19-36').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('play:roulette:straight').setLabel('Number (0-36)').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('bal').setLabel('残高確認').setStyle(ButtonStyle.Secondary));
    return { embeds: [embed], components: [row1, row2] };
}
function baccaratPlayPanel() {
    const embed = new EmbedBuilder()
        .setTitle(L('BACCARAT'))
        .setColor(0x065f46)
        .setDescription('8 デッキ、標準的な Baccarat ルール (Punto Banco)。')
        .addFields({ name: '配当', value: '・Player 勝ち **1:1**\n' +
            '・Banker 勝ち **1:0.95** (5% コミッション)\n' +
            '・Tie **8:1**',
        inline: false }, { name: '最小 / 最大 BET', value: '`10` / `50,000` chips', inline: true }, { name: 'ハウスエッジ', value: 'Banker 1.06% / Player 1.24% / Tie 14.4%', inline: true })
        .setFooter({ text: '賭け先を押して BET 額を入力' });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('play:baccarat:player').setLabel('Player').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('play:baccarat:banker').setLabel('Banker').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('play:baccarat:tie').setLabel('Tie').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('bal').setLabel('残高確認').setStyle(ButtonStyle.Secondary));
    return { embeds: [embed], components: [row] };
}
function crapsPlayPanel() {
    const embed = new EmbedBuilder()
        .setTitle(L('CRAPS'))
        .setColor(0xb45309)
        .setDescription('2 ダイスで Point / Come-out を解決。複数 BET をテーブルに置いて同時解決します。\n' +
        '賭けの種類を選ぶと、今の BET 額で台に置きます。');
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cr:start').setLabel('PLAY').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('bal').setLabel('残高確認').setStyle(ButtonStyle.Secondary));
    return { embeds: [embed], components: [row] };
}
const GAME_INFO = {
    blackjack: bjPlayPanel, slots: slotsPlayPanel, videopoker: vpPlayPanel,
    roulette: roulettePlayPanel, baccarat: baccaratPlayPanel, craps: crapsPlayPanel,
};
/** チャンネルに置くゲームのパネル。全ゲーム共通で [PLAY] [入金] [残高]。 */
export function publicGamePanel(game) {
    const embed = EmbedBuilder.from(GAME_INFO[game]().embeds[0])
        .setFooter({ text: 'PLAY で自分専用のテーブルが開きます。BET 額は次回も引き継がれます' });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`play:${game}`).setLabel('PLAY').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`dep:open:${game}`).setLabel('入金').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('bal').setLabel('残高').setStyle(ButtonStyle.Secondary));
    return { embeds: [embed], components: [row] };
}
/**
 * 残高カード (画像 embed)。/balance と Cashier パネルの残高確認で使用。
 * 返り値をそのまま interaction.reply に展開できる形で返す。
 */
export async function balanceReply(pp, ltc, note) {
    const png = await renderBalance({ pp, ltc, note });
    const file = new AttachmentBuilder(png, { name: 'balance.png' });
    const embed = new EmbedBuilder()
        .setColor(0xd4af37)
        .setImage('attachment://balance.png')
        .setFooter({ text: '入金したレール分だけ、そのレールで出金できます' });
    return { embeds: [embed], files: [file] };
}
export function depositPanel() {
    const embed = new EmbedBuilder()
        .setTitle(`${L('CASHIER')}`)
        .setDescription(`**1 ${L('chip')} = ¥1 の内部通貨**。入金で発行、出金で焼却。\n` +
        `残高は **PayPay 由来** と **LTC 由来** に分かれて管理されます。\n` +
        `**出金は入金したレール分が上限** — PayPay で入れた分は PayPay から、LTC で入れた分は LTC から。\n` +
        `残高確認ボタンで自分のゲージを表示できます。`)
        .setColor(0xd4af37)
        .addFields({ name: '入金', value: `**PayPay** 送金リンクを貼るだけで即 chip 加算 (¥${MIN_DEPOSIT_JPY.paypay}〜) — PayPay 側に加算\n` +
            `**LTC**    アドレスを発行、1 承認で自動チャージ (¥${MIN_DEPOSIT_JPY.ltc}〜) — LTC 側に加算`,
        inline: false }, { name: '出金', value: `**PayPay** 手数料ゼロ・自動送金 (¥${MIN_WITHDRAW_JPY.paypay}〜 / PayPay 由来の範囲)\n` +
            `**LTC**    任意アドレス指定・ネットワーク手数料あり (¥${MIN_WITHDRAW_JPY.ltc}〜 / LTC 由来の範囲)`,
        inline: false }, { name: L('Rate'), value: `LTC は CoinGecko の現在レートで JPY 換算`, inline: false })
        .setFooter({ text: 'Discord C4sino · Cashier' });
    // トップレベルは「入金」「出金」「残高確認」の 3 つのみ。
    // 入金/出金を押すと ephemeral で支払い方法の選択ボタンが出る (2 段階)。
    // SelectMenu は永続パネルで「選択済み」状態が残る仕様があるため使わない。
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('dep:open').setLabel('入金').setStyle(ButtonStyle.Success).setEmoji('💵'), new ButtonBuilder().setCustomId('wd:open').setLabel('出金').setStyle(ButtonStyle.Primary).setEmoji('💸'), new ButtonBuilder().setCustomId('bal').setLabel('残高確認').setStyle(ButtonStyle.Secondary));
    return { embeds: [embed], components: [row] };
}
/** 「入金」ボタンから開く支払い方法選択 (ephemeral)。 */
export function depositMethodPicker(ctx = '') {
    // ctx があればゲームのリザルト画面から来た入金。完了画面で同じゲームに Replay できるよう持ち回る。
    const suffix = ctx ? `:${ctx}` : '';
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`dep:paypay${suffix}`).setLabel('PayPay').setStyle(ButtonStyle.Success).setEmoji('🅿️'), new ButtonBuilder().setCustomId(`dep:ltc${suffix}`).setLabel('LTC').setStyle(ButtonStyle.Success).setEmoji('🪙'));
    return { content: '入金方法を選択してください', components: [row] };
}
/** 「出金」ボタンから開く支払い方法選択 (ephemeral)。 */
export function withdrawMethodPicker() {
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('wd:paypay').setLabel('PayPay').setStyle(ButtonStyle.Primary).setEmoji('🅿️'), new ButtonBuilder().setCustomId('wd:ltc').setLabel('LTC').setStyle(ButtonStyle.Primary).setEmoji('🪙'));
    return { content: '出金方法を選択してください', components: [row] };
}
export function bjActionsRow(actions) {
    const map = {
        hit: { label: L('HIT'), style: ButtonStyle.Primary },
        stand: { label: L('STAND'), style: ButtonStyle.Secondary },
        double: { label: L('DOUBLE'), style: ButtonStyle.Danger },
        split: { label: L('SPLIT'), style: ButtonStyle.Success },
    };
    const row = new ActionRowBuilder();
    for (const a of actions) {
        const m = map[a];
        row.addComponents(new ButtonBuilder().setCustomId(`bj:act:${a}`).setLabel(m.label).setStyle(m.style));
    }
    return row;
}
/* ────────────── MWS (cloud.m-ws.cc) 7 日延長タイマー ────────────── */
const MWS_BAR_WIDTH = 24;
function mwsBar(state) {
    const r = elapsedRatio(state);
    const filled = Math.round(MWS_BAR_WIDTH * r);
    return '█'.repeat(filled) + '░'.repeat(MWS_BAR_WIDTH - filled);
}
function mwsStatusColor(remainingSec) {
    if (remainingSec <= 0)
        return 0x991b1b; // 期限切れ: 暗赤
    if (remainingSec <= 3600)
        return 0xdc2626; // 残り 1h 以下: 赤
    if (remainingSec <= 6 * 3600)
        return 0xf59e0b; // 残り 6h 以下: 橙
    if (remainingSec <= 24 * 3600)
        return 0xeab308; // 残り 24h 以下: 黄
    return 0x10b981; // 余裕: 緑
}
/**
 * MWS 7 日タイマーパネル。
 * 現在の残り時間・最終延長時刻・通知設定を表示し、
 * - 延長完了ボタン (タイマーリセット、管理者のみ)
 * - 通知設定ボタン (このチャンネル・ロール指定、管理者のみ)
 * - 更新ボタン (誰でも)
 * を配置する。
 */
export function mwsPanel(state) {
    const bar = mwsBar(state);
    const extendedAt = `<t:${state.lastExtendedAt}:f>`;
    const expiresAt = `<t:${state.expiresAt}:f> (<t:${state.expiresAt}:R>)`;
    const remaining = formatRemaining(state.remainingSec);
    const notify = state.notifyChannelId
        ? `<#${state.notifyChannelId}>` + (state.notifyRoleId ? ` (<@&${state.notifyRoleId}> を mention)` : '')
        : '_未設定_';
    const embed = new EmbedBuilder()
        .setTitle('MWS Keep-Alive  —  cloud.m-ws.cc')
        .setDescription([
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
    ].join('\n'))
        .addFields({ name: '最終延長', value: extendedAt, inline: true }, { name: '次回期限', value: expiresAt, inline: true }, { name: '通知先', value: notify, inline: false })
        .setColor(mwsStatusColor(state.remainingSec))
        .setFooter({ text: `MWS keep-alive · 7日 ごとに手動延長が必要` });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('mws:extended').setLabel('延長完了 (タイマーリセット)').setStyle(ButtonStyle.Success).setEmoji('🔁'), new ButtonBuilder().setCustomId('mws:notify_here').setLabel('通知先をこのチャンネルに').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('mws:notify_clear').setLabel('通知先を解除').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('mws:refresh').setLabel('更新').setStyle(ButtonStyle.Secondary));
    return { embeds: [embed], components: [row] };
}
/**
 * 通知チャンネルに流す警告メッセージ (24h / 6h / 1h / expired)。
 */
export function mwsWarningText(bucket, state, roleMention) {
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
