import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('このチャンネルにカジノパネルを設置')
    .addStringOption(o => o.setName('game').setDescription('ゲーム').setRequired(true)
      .addChoices(
        { name: 'Blackjack', value: 'blackjack' },
        { name: 'Slots',     value: 'slots' },
        { name: 'Cashier (入金)', value: 'cashier' },
      )),
  new SlashCommandBuilder()
    .setName('balance')
    .setDescription('残高を確認'),
  new SlashCommandBuilder()
    .setName('admin-channel')
    .setDescription('PayPay承認通知を流すチャンネルを登録 (管理者)'),
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);
const clientId = process.env.DISCORD_CLIENT_ID!;
const guildId  = process.env.DISCORD_GUILD_ID;

const route = guildId
  ? Routes.applicationGuildCommands(clientId, guildId)
  : Routes.applicationCommands(clientId);

await rest.put(route, { body: commands });
console.log('slash commands registered.');
