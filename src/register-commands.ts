import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

const setup = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('このチャンネルにカジノパネルを設置')
  .addStringOption(o => o.setName('game').setDescription('ゲーム').setRequired(true)
    .addChoices(
      { name: 'Blackjack',   value: 'blackjack' },
      { name: 'Slots',       value: 'slots' },
      { name: 'Roulette',    value: 'roulette' },
      { name: 'Baccarat',    value: 'baccarat' },
      { name: 'Video Poker', value: 'videopoker' },
      { name: 'Craps',       value: 'craps' },
      { name: 'Cashier (入金)', value: 'cashier' },
    ));

const balance = new SlashCommandBuilder()
  .setName('balance')
  .setDescription('残高を確認');

const overview = new SlashCommandBuilder()
  .setName('overview')
  .setDescription('ユーザー向け説明パネルをこのチャンネルに設置 (管理者)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels.toString())
  .addStringOption(o => o.setName('game').setDescription('設置するパネル').setRequired(true)
    .addChoices(
      { name: 'All  (全ゲーム概要)',  value: 'all' },
      { name: 'Blackjack',             value: 'blackjack' },
      { name: 'Slots',                 value: 'slots' },
      { name: 'Roulette',              value: 'roulette' },
      { name: 'Baccarat',              value: 'baccarat' },
      { name: 'Video Poker',           value: 'videopoker' },
      { name: 'Craps',                 value: 'craps' },
      { name: 'Cashier (入金について)', value: 'cashier' },
    ));

const pay = new SlashCommandBuilder()
  .setName('pay')
  .setDescription('入金 — 支払い方法を選択してチップを購入')
  .addStringOption(o => o.setName('method').setDescription('支払い方法').setRequired(true)
    .addChoices(
      { name: 'PayPay (送金リンク)', value: 'paypay' },
      { name: 'LTC (Litecoin)',       value: 'ltc' },
    ))
  .addIntegerOption(o => o.setName('amount').setDescription('(LTCのみ) 入金希望額 JPY. 省略時は見積りなしでアドレスのみ').setRequired(false));

const withdraw = new SlashCommandBuilder()
  .setName('withdraw')
  .setDescription('出金 — chip を PayPay または LTC で引き出す')
  .addStringOption(o => o.setName('method').setDescription('出金方法').setRequired(true)
    .addChoices(
      { name: 'PayPay (手数料無料, ¥1〜)', value: 'paypay' },
      { name: 'LTC (手数料あり, ¥1,000〜)', value: 'ltc' },
    ));

const wallet = new SlashCommandBuilder()
  .setName('wallet')
  .setDescription('カジノ運営ウォレット管理 (管理者)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
  .addSubcommand(s => s.setName('add-paypay').setDescription('PayPay ウォレットを追加 (ログイン)')
    .addStringOption(o => o.setName('label').setDescription('識別名').setRequired(true)))
  .addSubcommand(s => s.setName('add-ltc').setDescription('LTC ウォレット追加 (address 省略で自動送金可能な HOT ウォレット生成)')
    .addStringOption(o => o.setName('label').setDescription('識別名').setRequired(true))
    .addStringOption(o => o.setName('address').setDescription('既存アドレス (省略で自動生成)').setRequired(false)))
  .addSubcommand(s => s.setName('list').setDescription('ウォレット一覧'))
  .addSubcommand(s => s.setName('enable').setDescription('ウォレット有効化')
    .addIntegerOption(o => o.setName('id').setDescription('wallet id').setRequired(true)))
  .addSubcommand(s => s.setName('disable').setDescription('ウォレット無効化')
    .addIntegerOption(o => o.setName('id').setDescription('wallet id').setRequired(true)))
  .addSubcommand(s => s.setName('remove').setDescription('ウォレット削除')
    .addIntegerOption(o => o.setName('id').setDescription('wallet id').setRequired(true)))
  .addSubcommand(s => s.setName('balance').setDescription('PayPay ウォレット残高を更新')
    .addIntegerOption(o => o.setName('id').setDescription('wallet id').setRequired(true)));

const admin = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('カジノ管理 (管理者)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
  .addSubcommand(s => s.setName('balance').setDescription('ユーザーのチップを増減')
    .addUserOption(o => o.setName('user').setDescription('対象ユーザー').setRequired(true))
    .addIntegerOption(o => o.setName('delta').setDescription('増減 (負で減算)').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('理由').setRequired(false)))
  .addSubcommand(s => s.setName('ban').setDescription('ユーザーをBAN')
    .addUserOption(o => o.setName('user').setDescription('対象ユーザー').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('理由').setRequired(false)))
  .addSubcommand(s => s.setName('unban').setDescription('BAN解除')
    .addUserOption(o => o.setName('user').setDescription('対象ユーザー').setRequired(true)))
  .addSubcommand(s => s.setName('stats').setDescription('カジノ全体の統計'))
  .addSubcommand(s => s.setName('tx').setDescription('ユーザーの取引履歴')
    .addUserOption(o => o.setName('user').setDescription('対象ユーザー').setRequired(true))
    .addIntegerOption(o => o.setName('limit').setDescription('件数').setRequired(false)))
  .addSubcommand(s => s.setName('panel').setDescription('管理パネルをこのチャンネルに設置'))
  .addSubcommand(s => s.setName('automod-sync').setDescription('ワード規制 (AutoMod) を このサーバーに同期'))
  .addSubcommand(s => s.setName('user').setDescription('ユーザー総合ビュー (残高/取引/セッション/BAN)')
    .addUserOption(o => o.setName('user').setDescription('対象ユーザー').setRequired(true)))
  .addSubcommand(s => s.setName('history').setDescription('ユーザーの全取引履歴 (入金/出金/BET/WIN/補助) を時系列で表示')
    .addUserOption(o => o.setName('user').setDescription('対象ユーザー').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('種類').setRequired(false)
      .addChoices(
        { name: 'All (全部)', value: 'all' },
        { name: 'Bets (BET のみ)', value: 'bets' },
        { name: 'Wins (WIN のみ)', value: 'wins' },
        { name: 'Deposits (入金)', value: 'deposits' },
        { name: 'Withdrawals (出金)', value: 'withdrawals' },
        { name: 'Grants (運営付与)', value: 'grants' },
      ))
    .addIntegerOption(o => o.setName('limit').setDescription('最大件数 (default 20)').setRequired(false).setMinValue(1).setMaxValue(50)))
  .addSubcommand(s => s.setName('pending').setDescription('保留中/直近の出金一覧 (ボタンで承認・却下)')
    .addStringOption(o => o.setName('method').setDescription('method 絞り込み').setRequired(false)
      .addChoices({ name: 'PayPay', value: 'paypay' }, { name: 'LTC', value: 'ltc' }))
    .addIntegerOption(o => o.setName('limit').setDescription('件数 (default 10)').setRequired(false)))
  .addSubcommand(s => s.setName('grant').setDescription('ユーザーに chip を特定レールで付与 (運営サービス)')
    .addUserOption(o => o.setName('user').setDescription('対象ユーザー').setRequired(true))
    .addStringOption(o => o.setName('rail').setDescription('どちら由来の chip か').setRequired(true)
      .addChoices({ name: 'PayPay', value: 'pp' }, { name: 'LTC', value: 'ltc' }))
    .addIntegerOption(o => o.setName('amount').setDescription('金額 (JPY、負値で減算)').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('理由').setRequired(false)))
  .addSubcommand(s => s.setName('send-paypay').setDescription('運営から個別ユーザーへ PayPay 送金リンクを発行 (chip は触らない)')
    .addUserOption(o => o.setName('user').setDescription('送金先ユーザー').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('送金額 (JPY)').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('passcode').setDescription('リンクパスコード (推奨)').setRequired(false))
    .addStringOption(o => o.setName('reason').setDescription('理由 (compensation など)').setRequired(false)))
  .addSubcommand(s => s.setName('send-ltc').setDescription('運営から個別ユーザーへ LTC を手動送金 (chip は触らない)')
    .addUserOption(o => o.setName('user').setDescription('送金先ユーザー (DM 通知用)').setRequired(true))
    .addStringOption(o => o.setName('dest').setDescription('送金先 LTC アドレス').setRequired(true))
    .addNumberOption(o => o.setName('ltc').setDescription('送金 LTC 数').setRequired(true).setMinValue(0.0001))
    .addStringOption(o => o.setName('reason').setDescription('理由').setRequired(false)))
  .addSubcommand(s => s.setName('achievements')
    .setDescription('実績 (当選履歴) を流すチャンネルを設定/解除')
    .addChannelOption(o => o.setName('channel').setDescription('設定するチャンネル (空で解除)').setRequired(false))
    .addStringOption(o => o.setName('base').setDescription('チャンネル名のベース (例: 実績 → 実績-実績12件)').setRequired(false)));

const bannedWords = new SlashCommandBuilder()
  .setName('banned-words')
  .setDescription('ワード規制 (AutoMod) の NG ワード管理 (管理者)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
  .addSubcommand(s => s.setName('add').setDescription('NG ワードを追加')
    .addStringOption(o => o.setName('word').setDescription('追加するワード (60文字以下)').setRequired(true)))
  .addSubcommand(s => s.setName('list').setDescription('NG ワード一覧を表示'))
  .addSubcommand(s => s.setName('remove').setDescription('NG ワードを削除')
    .addStringOption(o => o.setName('word').setDescription('削除するワード').setRequired(true)));

const gamePanel = (name: string, title: string) => new SlashCommandBuilder()
  .setName(name).setDescription(`${title} 卓をこのチャンネルに設置 (管理者)`)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels.toString());

const blackjackCmd  = gamePanel('blackjack',  'Blackjack');
const slotsCmd      = gamePanel('slots',      'Slots');
const rouletteCmd   = gamePanel('roulette',   'Roulette');
const baccaratCmd   = gamePanel('baccarat',   'Baccarat');
const videopokerCmd = gamePanel('videopoker', 'Video Poker');
const crapsCmd      = gamePanel('craps',      'Craps');

const leetCmd = new SlashCommandBuilder()
  .setName('leet')
  .setDescription('LEET 変換パネルをこのチャンネルに設置 (管理者)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString());

const paypay = new SlashCommandBuilder()
  .setName('paypay')
  .setDescription('PayPay 直接操作 (管理者)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
  .addSubcommand(s => s.setName('login').setDescription('PayPay アカウントでログインしてウォレット追加')
    .addStringOption(o => o.setName('label').setDescription('識別名 (例: main)').setRequired(true)))
  .addSubcommand(s => s.setName('balance').setDescription('登録済み PayPay ウォレットの残高を一覧'))
  .addSubcommand(s => s.setName('transfer').setDescription('運営利益受取用の送金リンクを生成')
    .addIntegerOption(o => o.setName('amount').setDescription('送金額 (JPY)').setRequired(true).setMinValue(1))
    .addIntegerOption(o => o.setName('wallet').setDescription('送金元 wallet id (省略で自動選択)').setRequired(false))
    .addStringOption(o => o.setName('passcode').setDescription('リンクのパスコード (省略可、推奨)').setRequired(false)));

const commands = [
  setup, balance, overview, pay, withdraw, wallet, admin, bannedWords, paypay, leetCmd,
  blackjackCmd, slotsCmd, rouletteCmd, baccaratCmd, videopokerCmd, crapsCmd,
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);
const clientId = process.env.DISCORD_CLIENT_ID!;
const guildId  = process.env.DISCORD_GUILD_ID;

const route = guildId
  ? Routes.applicationGuildCommands(clientId, guildId)
  : Routes.applicationCommands(clientId);

await rest.put(route, { body: commands });
console.log('slash commands registered.');
