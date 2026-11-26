import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
// Discord の制約: description は 1〜100 文字。各行はこの上限ギリギリまで詳しく書く。
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
// 運営操作は全部 /admin panel で置く管理パネルから行う
const admin = new SlashCommandBuilder()
    .setName('admin')
    .setDescription('運営用 (管理者)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
    .addSubcommand(sub => sub.setName('panel')
    .setDescription('管理パネルをこのチャンネルに設置。パネル設置・ウォレット・NG ワード・ユーザー管理はここから'));
export const COMMAND_JSON = [
    balance, pay, withdraw, admin,
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
