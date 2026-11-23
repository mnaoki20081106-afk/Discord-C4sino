import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
// Discord の制約: description は 1〜100 文字。各行はこの上限ギリギリまで詳しく書く。
const setup = new SlashCommandBuilder()
    .setName('setup')
    .setDescription('パネルをこのチャンネルに設置 (管理者)。type でゲーム用か説明用かを選ぶ')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels.toString())
    .addStringOption(o => o.setName('type')
    .setDescription('panel = ベット開始用パネル / overview = ルール・配当表の説明パネル (all は overview 専用)')
    .setRequired(true)
    .addChoices({ name: 'ゲームパネル (ベット開始用)', value: 'panel' }, { name: 'ルール説明 (配当表・遊び方)', value: 'overview' }))
    .addStringOption(o => o.setName('game')
    .setDescription('どの種類を設置するか。all は type=overview の時のみ有効 (全ゲーム概要を1枚に)')
    .setRequired(true)
    .addChoices({ name: 'All  (全ゲーム概要を 1 枚, overview 専用)', value: 'all' }, { name: 'Blackjack', value: 'blackjack' }, { name: 'Slots', value: 'slots' }, { name: 'Roulette', value: 'roulette' }, { name: 'Baccarat', value: 'baccarat' }, { name: 'Video Poker', value: 'videopoker' }, { name: 'Craps', value: 'craps' }, { name: 'Cashier (入金・出金)', value: 'cashier' }));
const mwsCmd = new SlashCommandBuilder()
    .setName('mws')
    .setDescription('MWS の 7 日延長タイマーパネルをこのチャンネルに設置 (管理者)。残り 24h/6h/1h で通知')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels.toString());
const balance = new SlashCommandBuilder()
    .setName('balance')
    .setDescription('自分のチップ残高を表示。PayPay由来/LTC由来の内訳ゲージも出る (ephemeral)');
const pay = new SlashCommandBuilder()
    .setName('pay')
    .setDescription('入金してチップを購入。PayPay は送金リンクを貼るだけ / LTC は専用アドレスへ送金')
    .addStringOption(o => o.setName('method')
    .setDescription('支払い方法。PayPay は即時反映 / LTC は 3 承認 (約 8 分) で自動反映')
    .setRequired(true)
    .addChoices({ name: 'PayPay (送金リンク、¥1〜、手数料無料、即反映)', value: 'paypay' }, { name: 'LTC (アドレス発行、¥1,000〜、3承認で反映)', value: 'ltc' }))
    .addIntegerOption(o => o.setName('amount')
    .setDescription('(LTC のみ) 入金希望額を JPY で指定。LTC 数と受取予定が見積り表示される。省略可')
    .setRequired(false));
const withdraw = new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('チップを現金化して出金。入金したレール (PayPay/LTC) の分だけそれぞれで出せる')
    .addStringOption(o => o.setName('method')
    .setDescription('出金方法。LTC は最低 1 回のゲームプレイが必要 (入金直後の即出金は不可)')
    .setRequired(true)
    .addChoices({ name: 'PayPay (手数料無料・¥1〜・即時に送金リンクDM)', value: 'paypay' }, { name: 'LTC (手数料あり・¥1,000〜・自動ブロードキャスト)', value: 'ltc' }));
const wallet = new SlashCommandBuilder()
    .setName('wallet')
    .setDescription('運営が入出金に使う PayPay/LTC ウォレットを登録・一覧・有効無効・削除する (管理者)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
    .addSubcommand(s => s.setName('add-paypay')
    .setDescription('運営 PayPay アカウントでログインしてウォレット追加。SMS 認証が走る')
    .addStringOption(o => o.setName('label')
    .setDescription('複数運用時に識別する名前 (例: main, sub1)。後で /wallet list で表示される')
    .setRequired(true)))
    .addSubcommand(s => s.setName('add-ltc')
    .setDescription('LTC ウォレット追加。address 省略で秘密鍵付き HOT ウォレット自動生成 (自動送金可能に)')
    .addStringOption(o => o.setName('label')
    .setDescription('識別名 (例: hot, cold)。list で表示される').setRequired(true))
    .addStringOption(o => o.setName('address')
    .setDescription('既存アドレスを使う場合のみ指定。省略で Bot がローカル生成 (推奨)')
    .setRequired(false)))
    .addSubcommand(s => s.setName('list')
    .setDescription('登録済ウォレット一覧 (id, kind, label, 有効/無効, 残高キャッシュ)'))
    .addSubcommand(s => s.setName('enable')
    .setDescription('ウォレットを有効化 (= 入出金フローの選択候補に含まれる)')
    .addIntegerOption(o => o.setName('id').setDescription('有効化する wallet id (/wallet list で確認)').setRequired(true)))
    .addSubcommand(s => s.setName('disable')
    .setDescription('ウォレットを無効化 (= 一時的に使わない。登録は残す)')
    .addIntegerOption(o => o.setName('id').setDescription('無効化する wallet id').setRequired(true)))
    .addSubcommand(s => s.setName('remove')
    .setDescription('ウォレット削除 (DB から完全削除、PayPay トークンも消える。要注意)')
    .addIntegerOption(o => o.setName('id').setDescription('削除する wallet id').setRequired(true)))
    .addSubcommand(s => s.setName('balance')
    .setDescription('指定 PayPay ウォレットの残高を実 API で取得して DB キャッシュを更新')
    .addIntegerOption(o => o.setName('id').setDescription('残高更新する wallet id').setRequired(true)));
const admin = new SlashCommandBuilder()
    .setName('admin')
    .setDescription('カジノ運営操作の総合ハブ: ユーザー管理・統計・取引照会・手動入出金 (管理者)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
    .addSubcommand(s => s.setName('balance')
    .setDescription('ユーザーのチップ残高を直接増減 (監査ログ必須、±10万まで)')
    .addUserOption(o => o.setName('user').setDescription('残高を変更する対象ユーザー').setRequired(true))
    .addIntegerOption(o => o.setName('delta')
    .setDescription('±100,000 chips まで。正値で加算、負値で減算。不正で凍結はこの場で可能')
    .setRequired(true))
    .addStringOption(o => o.setName('reason')
    .setDescription('監査ログ用の理由 (必須)。admin チャンネルに通知される')
    .setRequired(false)))
    .addSubcommand(s => s.setName('ban')
    .setDescription('ユーザーの利用を停止。ベット/入出金すべて拒否される (残高は凍結のまま残る)')
    .addUserOption(o => o.setName('user').setDescription('BAN する対象ユーザー').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('理由 (任意、user_bans テーブルに保存)').setRequired(false)))
    .addSubcommand(s => s.setName('unban')
    .setDescription('BAN 解除。user_bans から該当行を削除してユーザーが再度プレイ可能に')
    .addUserOption(o => o.setName('user').setDescription('BAN 解除する対象ユーザー').setRequired(true)))
    .addSubcommand(s => s.setName('stats')
    .setDescription('カジノ全体の統計: 流通チップ・累計BET/WIN・ハウスエッジ・流動性・許容BET上限'))
    .addSubcommand(s => s.setName('tx')
    .setDescription('指定ユーザーの最新取引履歴を簡易表示 (詳細は /admin history)')
    .addUserOption(o => o.setName('user').setDescription('履歴を見るユーザー').setRequired(true))
    .addIntegerOption(o => o.setName('limit')
    .setDescription('表示件数 1-50 (default 10)').setRequired(false)))
    .addSubcommand(s => s.setName('panel')
    .setDescription('管理者用ショートカット (統計・ユーザー調査等) を集めたパネルを常設'))
    .addSubcommand(s => s.setName('automod-sync')
    .setDescription('旧 AutoMod 単語ブロックルールを削除 (現在は Webhook 書き換え方式に移行済)'))
    .addSubcommand(s => s.setName('user')
    .setDescription('ユーザー総合ビュー: 残高ゲージ + 累計 BET/WIN + 直近出金/取引 + 稼働中セッション')
    .addUserOption(o => o.setName('user').setDescription('調査するユーザー').setRequired(true)))
    .addSubcommand(s => s.setName('history')
    .setDescription('ユーザーの全取引履歴を時系列で表示。絶対日時付き・種類フィルタ可')
    .addUserOption(o => o.setName('user').setDescription('履歴を見るユーザー').setRequired(true))
    .addStringOption(o => o.setName('type')
    .setDescription('種類で絞り込み (default: all = BET/WIN/入金/出金/運営付与すべて)')
    .setRequired(false)
    .addChoices({ name: 'All (全部)', value: 'all' }, { name: 'Bets (BET のみ)', value: 'bets' }, { name: 'Wins (WIN のみ)', value: 'wins' }, { name: 'Deposits (入金)', value: 'deposits' }, { name: 'Withdrawals (出金)', value: 'withdrawals' }, { name: 'Grants (運営付与・剥奪・refund)', value: 'grants' }))
    .addIntegerOption(o => o.setName('limit')
    .setDescription('最大件数 1-50 (default 20)')
    .setRequired(false).setMinValue(1).setMaxValue(50)))
    .addSubcommand(s => s.setName('pending')
    .setDescription('保留中/直近の出金一覧。pending LTC には承認/却下ボタンを自動付与')
    .addStringOption(o => o.setName('method').setDescription('method 絞り込み (省略で両方表示)').setRequired(false)
    .addChoices({ name: 'PayPay', value: 'paypay' }, { name: 'LTC', value: 'ltc' }))
    .addIntegerOption(o => o.setName('limit').setDescription('表示件数 1-25 (default 10)').setRequired(false)))
    .addSubcommand(s => s.setName('grant')
    .setDescription('運営補償などで特定レール (PP/LTC) 由来のチップを付与・剥奪。実運営残高は動かない')
    .addUserOption(o => o.setName('user').setDescription('チップを付与/剥奪する対象ユーザー').setRequired(true))
    .addStringOption(o => o.setName('rail').setDescription('どちら由来の chip として扱うか').setRequired(true)
    .addChoices({ name: 'PayPay 由来', value: 'pp' }, { name: 'LTC 由来', value: 'ltc' }))
    .addIntegerOption(o => o.setName('amount').setDescription('金額 (JPY)。正値で付与、負値で剥奪').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('理由 (監査ログに記録)').setRequired(false)))
    .addSubcommand(s => s.setName('send-paypay')
    .setDescription('運営から個別ユーザーへ PayPay 送金リンクを手動発行 (補償用、chip は触らない)')
    .addUserOption(o => o.setName('user').setDescription('送金先ユーザー (リンクを DM 送信)').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('送金額 JPY (¥1 以上)').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('passcode').setDescription('リンクのパスコード 4 桁数字 (推奨)').setRequired(false))
    .addStringOption(o => o.setName('reason').setDescription('理由 (compensation / refund 等)').setRequired(false)))
    .addSubcommand(s => s.setName('send-ltc')
    .setDescription('運営 HOT から任意 LTC アドレスへ手動送金 (運営利益回収・補償等、chip は触らない)')
    .addUserOption(o => o.setName('user').setDescription('送金完了を DM 通知するユーザー').setRequired(true))
    .addStringOption(o => o.setName('dest').setDescription('送金先 LTC アドレス (L/M/ltc1 のみ受付)').setRequired(true))
    .addNumberOption(o => o.setName('ltc').setDescription('送金 LTC 数 (最低 0.0001)').setRequired(true).setMinValue(0.0001))
    .addStringOption(o => o.setName('reason').setDescription('理由 (監査ログに記録)').setRequired(false)))
    .addSubcommand(s => s.setName('achievements')
    .setDescription('当選履歴を自動投稿するチャンネルを設定。件数で名前も自動更新 (例: 実績-12件)')
    .addChannelOption(o => o.setName('channel').setDescription('設定するチャンネル (空で設定解除)').setRequired(false))
    .addStringOption(o => o.setName('base').setDescription('チャンネル名のベース (例: 実績 → 実績-12件)').setRequired(false)));
const bannedWords = new SlashCommandBuilder()
    .setName('banned-words')
    .setDescription('NG ワード管理。該当投稿は削除され Webhook で伏字版を投稿者名で再投稿される (管理者)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
    .addSubcommand(s => s.setName('add')
    .setDescription('NG ワードを追加。該当投稿は即削除+伏字化で webhook 再投稿される')
    .addStringOption(o => o.setName('word').setDescription('追加するワード (60文字以下、ASCII+日本語可)').setRequired(true)))
    .addSubcommand(s => s.setName('list')
    .setDescription('登録済 NG ワード一覧 (内蔵語 + ギルド独自追加語)'))
    .addSubcommand(s => s.setName('remove')
    .setDescription('登録済 NG ワードを削除 (内蔵語は削除不可)')
    .addStringOption(o => o.setName('word').setDescription('削除するワード').setRequired(true)));
const gamePanel = (name, title, rules) => new SlashCommandBuilder()
    .setName(name).setDescription(`${title} 卓をこのチャンネルに設置: ${rules} (管理者)`)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels.toString());
const blackjackCmd = gamePanel('blackjack', 'Blackjack', '6デッキ H17 BJ 3:2 Double/Split対応');
const slotsCmd = gamePanel('slots', 'Slots', '3リール8シンボル RTP 94-96% 最大2300x');
const rouletteCmd = gamePanel('roulette', 'Roulette', 'ヨーロピアン Straight 35:1 色2倍 0=緑');
const baccaratCmd = gamePanel('baccarat', 'Baccarat', '8デッキ Banker 1:0.95 Tie 8:1');
const videopokerCmd = gamePanel('videopoker', 'Video Poker', 'Jacks or Better 9/6 RTP 99.5%');
const crapsCmd = gamePanel('craps', 'Craps', '2ダイス 複数BET同時 Pass/Dont/Odds対応');
const leetCmd = new SlashCommandBuilder()
    .setName('leet')
    .setDescription('運営用 LEET 変換パネルを設置 (アルファベットを Unicode lookalike に伏字化) (管理者)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString());
const paypay = new SlashCommandBuilder()
    .setName('paypay')
    .setDescription('PayPay 直接操作ハブ: ログイン/残高一覧/利益引き出し (管理者)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
    .addSubcommand(s => s.setName('login')
    .setDescription('PayPay アカウントでログインしてウォレット追加 (/wallet add-paypay と同等、SMS 認証)')
    .addStringOption(o => o.setName('label').setDescription('複数運用時の識別名 (例: main)').setRequired(true)))
    .addSubcommand(s => s.setName('balance')
    .setDescription('登録済全 PayPay ウォレットの残高を実 API で取得して一覧表示 + 合計を集計'))
    .addSubcommand(s => s.setName('transfer')
    .setDescription('運営利益を自分の PayPay に引き出し。送金リンクを ephemeral 返信で表示')
    .addIntegerOption(o => o.setName('amount').setDescription('引き出し額 JPY (¥1 以上、流通チップ下限を割らない範囲で許可)')
    .setRequired(true).setMinValue(1))
    .addIntegerOption(o => o.setName('wallet').setDescription('送金元 wallet id (省略で残高多い方を自動選択)').setRequired(false))
    .addStringOption(o => o.setName('passcode').setDescription('リンクパスコード 4 桁数字 (強く推奨)').setRequired(false)));
export const COMMAND_JSON = [
    setup, balance, pay, withdraw, wallet, admin, bannedWords, paypay, leetCmd, mwsCmd,
    blackjackCmd, slotsCmd, rouletteCmd, baccaratCmd, videopokerCmd, crapsCmd,
].map(c => c.toJSON());
/** 任意の token/clientId/guildId を使ってスラッシュコマンドを Discord に PUT する。
 *  スクリプト (npm run register) と、index.ts からの起動時自動登録の両方から呼ぶ。 */
export async function registerSlashCommands(opts) {
    const token = opts?.token ?? process.env.DISCORD_TOKEN;
    const clientId = opts?.clientId ?? process.env.DISCORD_CLIENT_ID;
    const guildId = opts?.guildId ?? process.env.DISCORD_GUILD_ID;
    const rest = new REST({ version: '10' }).setToken(token);
    const route = guildId
        ? Routes.applicationGuildCommands(clientId, guildId)
        : Routes.applicationCommands(clientId);
    await rest.put(route, { body: COMMAND_JSON });
    console.log(`[register] ${COMMAND_JSON.length} slash commands registered (${guildId ? `guild ${guildId}` : 'global'})`);
}
// top-level script: `npm run register` / `tsx src/register-commands.ts` で直接実行された場合のみ登録。
// import から import された場合 (index.ts の auto-register) では走らせない。
const _argv1 = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : '';
const _directRun = /\/register-commands\.(ts|js|mjs|cjs)$/.test(_argv1);
if (_directRun) {
    await registerSlashCommands();
}
