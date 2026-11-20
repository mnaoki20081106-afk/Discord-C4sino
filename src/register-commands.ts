import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

const setup = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('このチャンネルにカジノパネルを設置')
  .addStringOption(o => o.setName('game').setDescription('ゲーム').setRequired(true)
    .addChoices(
      { name: 'Blackjack', value: 'blackjack' },
      { name: 'Slots',     value: 'slots' },
      { name: 'Cashier (入金)', value: 'cashier' },
    ));

const balance = new SlashCommandBuilder()
  .setName('balance')
  .setDescription('残高を確認');

const pay = new SlashCommandBuilder()
  .setName('pay')
  .setDescription('入金 — 支払い方法を選択してチップを購入')
  .addStringOption(o => o.setName('method').setDescription('支払い方法').setRequired(true)
    .addChoices(
      { name: 'PayPay (送金リンク)', value: 'paypay' },
      { name: 'LTC (Litecoin)',       value: 'ltc' },
    ));

const wallet = new SlashCommandBuilder()
  .setName('wallet')
  .setDescription('カジノ運営ウォレット管理 (管理者)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
  .addSubcommand(s => s.setName('add-paypay').setDescription('PayPay ウォレットを追加 (ログイン)')
    .addStringOption(o => o.setName('label').setDescription('識別名').setRequired(true)))
  .addSubcommand(s => s.setName('add-ltc').setDescription('LTC ウォレットを追加')
    .addStringOption(o => o.setName('label').setDescription('識別名').setRequired(true))
    .addStringOption(o => o.setName('address').setDescription('LTC アドレス').setRequired(true)))
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
  .addSubcommand(s => s.setName('panel').setDescription('管理パネルをこのチャンネルに設置'));

const commands = [setup, balance, pay, wallet, admin].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);
const clientId = process.env.DISCORD_CLIENT_ID!;
const guildId  = process.env.DISCORD_GUILD_ID;

const route = guildId
  ? Routes.applicationGuildCommands(clientId, guildId)
  : Routes.applicationCommands(clientId);

await rest.put(route, { body: commands });
console.log('slash commands registered.');
