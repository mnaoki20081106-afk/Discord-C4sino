import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

// Discord の制約: description は 1〜100 文字。各行はこの上限ギリギリまで詳しく書く。

// コマンドは運営用の /admin panel だけ。ユーザーの操作は全部パネルのボタンで行う。
// 管理パネルは 3 種類を、それぞれ専用のチャンネルに置いて使う。
const admin = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('運営用 (管理者)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
  .addSubcommand(sub => sub.setName('panel')
    .setDescription('管理パネルをこのチャンネルに設置する')
    .addStringOption(o => o.setName('type')
      .setDescription('設置する管理パネル')
      .setRequired(true)
      .addChoices(
        { name: 'ゲーム管理パネル (パネルの設置・再設置)',           value: 'games' },
        { name: 'ウォレット管理パネル (運営の PayPay・LTC)',         value: 'wallet' },
        { name: 'サーバー管理パネル (NG ワード・ユーザー・運営データ)', value: 'server' },
      )));

export const COMMAND_JSON = [
  admin,
].map(c => c.toJSON());

/** 任意の token/clientId/guildId を使ってスラッシュコマンドを Discord に PUT する。
 *  スクリプト (npm run register) と、index.ts からの起動時自動登録の両方から呼ぶ。 */
export async function registerSlashCommands(opts?: { token?: string; clientId?: string; guildId?: string }): Promise<void> {
  const token = opts?.token ?? process.env.DISCORD_TOKEN!;
  const clientId = opts?.clientId ?? process.env.DISCORD_CLIENT_ID!;
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
