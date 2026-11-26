import { Client, EmbedBuilder, GuildTextBasedChannel } from 'discord.js';
import { db } from './db/schema.js';
import { L } from './ui/leet.js';
import { COLOR, GAME_ICON, ICON, e } from './ui/theme.js';

export interface AchievementRecord {
  guildId: string;
  discordId: string;
  game: 'blackjack' | 'slots' | 'roulette' | 'baccarat' | 'videopoker' | 'craps' | 'mines';
  bet: number;
  payout: number;
  net: number;
  /** 以下は当たり通知の表示だけに使う (記録には残さない) */
  mix?: { pp: number; ltc: number };
  /** 掛け方や役など */
  detail?: string;
  userName?: string;
  avatarUrl?: string;
}

const GAME_LABEL: Record<string, string> = {
  blackjack: 'Blackjack',
  slots:     'Slots',
  roulette:  'Roulette',
  baccarat:  'Baccarat',
  videopoker:'Video Poker',
  craps:     'Craps',
  mines:     'Mines',
};

export function countAchievements(guildId: string): number {
  return (db.prepare('SELECT COUNT(*) c FROM achievements WHERE guild_id=?').get(guildId) as any).c;
}

export function getConfig(guildId: string): { channelId: string | null; baseName: string | null } {
  const r = db.prepare('SELECT achievements_channel_id, achievements_base_name FROM guild_config WHERE guild_id=?').get(guildId) as any;
  return {
    channelId: r?.achievements_channel_id ?? null,
    baseName:  r?.achievements_base_name  ?? null,
  };
}

export function setConfig(guildId: string, channelId: string | null, baseName: string | null) {
  db.prepare(`INSERT INTO guild_config(guild_id, achievements_channel_id, achievements_base_name)
    VALUES (?,?,?)
    ON CONFLICT(guild_id) DO UPDATE SET
      achievements_channel_id=excluded.achievements_channel_id,
      achievements_base_name=excluded.achievements_base_name`)
    .run(guildId, channelId, baseName);
}

export function recordAchievement(a: AchievementRecord): number {
  const mult = a.bet > 0 ? a.payout / a.bet : null;
  const r = db.prepare(`INSERT INTO achievements(guild_id, discord_id, game, bet, payout, net, mult)
    VALUES (?,?,?,?,?,?,?)`).run(a.guildId, a.discordId, a.game, a.bet, a.payout, a.net, mult);
  return r.lastInsertRowid as number;
}

// ───────── チャンネル名リネーム (throttle: 最大5分に1回) ─────────
const pending = new Map<string, NodeJS.Timeout>();      // channelId -> timer
const lastRun = new Map<string, number>();              // channelId -> ts

const THROTTLE_MS = 5 * 60_000;

export function scheduleRename(client: Client, guildId: string, channelId: string, baseName: string) {
  if (pending.has(channelId)) return;                   // 既に次回更新待ち
  const last = lastRun.get(channelId) ?? 0;
  const wait = Math.max(0, THROTTLE_MS - (Date.now() - last));
  const t = setTimeout(async () => {
    pending.delete(channelId);
    try {
      const ch = await client.channels.fetch(channelId);
      if (!ch || !('setName' in ch)) return;
      const count = countAchievements(guildId);
      const name = formatChannelName(baseName, count);
      await (ch as GuildTextBasedChannel).setName(name);
      lastRun.set(channelId, Date.now());
    } catch (e) {
      console.warn('[achievements] rename failed:', (e as Error).message);
    }
  }, wait);
  pending.set(channelId, t);
}

export function formatChannelName(baseName: string, count: number): string {
  // 既に "ー実績N件" / "-実績N件" が付いていれば除去して付け直す
  const cleaned = baseName.replace(/[-_ー]実績\d+件$/, '').trim();
  return `${cleaned}ー実績${count}件`.replace(/\s+/g, '-');
}

// ───────── 当たり通知を送る ─────────
// 見た目はゲームの結果画面に合わせる。マインスイーパーは自分で降りた勝ちなので SMART MOVE! にする。
export async function announce(client: Client, a: AchievementRecord): Promise<void> {
  const cfg = getConfig(a.guildId);
  if (!cfg.channelId) return;
  const ch = await client.channels.fetch(cfg.channelId).catch(() => null);
  if (!ch || !('send' in ch)) return;

  const mult = a.bet > 0 ? a.payout / a.bet : 0;
  const tier =
    a.game === 'slots'     ? (mult >= 2000 ? 'JACKPOT' : mult >= 200 ? 'BIG WIN' : 'WIN')
  : a.game === 'roulette'  ? (mult >= 30   ? 'BIG WIN' : 'WIN')
  : a.game === 'videopoker'? (mult >= 500  ? 'JACKPOT' : mult >= 20 ? 'BIG WIN' : 'WIN')
  : a.game === 'baccarat'  ? (mult >= 8    ? 'BIG WIN' : 'WIN')
  : a.game === 'craps'     ? (mult >= 20   ? 'BIG WIN' : 'WIN')
  : a.game === 'mines'     ? (mult >= 100  ? 'JACKPOT' : mult >= 10 ? 'BIG WIN' : 'WIN')
  :                          (a.net >= a.bet * 4 ? 'BIG WIN' : 'WIN');
  await (ch as any).send({ embeds: [winEmbed(a, tier, mult)] });

  if (cfg.baseName) scheduleRename(client, a.guildId, cfg.channelId, cfg.baseName);
}

const yen = (n: number) => `¥${n.toLocaleString()}`;

/** 当たり通知の見た目 (テストしやすいよう送信と分けている) */
export function winEmbed(a: AchievementRecord, tier: string, mult: number): EmbedBuilder {
  const smart = a.game === 'mines';
  const head = smart ? `${e('win_star', '✦')} ${L('SMART MOVE!')}` : `${e('win_trophy', '◆')} ${L('CONGRATS!')}`;
  const badge = tier === 'JACKPOT' ? `${e('win_crown')} **${L('JACKPOT')}**` : tier === 'BIG WIN' ? `${ICON.fire()} **${L('BIG WIN')}**` : `**${L('WIN')}**`;
  const msg = smart
    ? `<@${a.discordId}> さん、見事な引き際！ 爆弾を避けきって CASH OUT`
    : `<@${a.discordId}> さん、おめでとうございます！`;
  const pp = a.mix?.pp ?? 0, ltc = a.mix?.ltc ?? 0;
  const betLine = a.mix
    ? [pp > 0 ? `${ICON.paypay()} PayPay ${yen(pp)}` : '', ltc > 0 ? `${ICON.ltc()} LTC ${yen(ltc)}` : ''].filter(Boolean).join('　')
    : yen(a.bet);

  const desc = [
    `# ${head}`,
    `${badge}　${msg}`,
    [`### ${(GAME_ICON[a.game]?.() ?? '')} ${L(GAME_LABEL[a.game])}`, ...(a.detail ? [`${ICON.arrow()} ${a.detail}`] : [])].join('\n'),
    [`### ${ICON.chip()} BET ${yen(a.bet)}`, betLine].join('\n'),
    [`## +${yen(a.net)}`, `払戻 ${yen(a.payout)}${mult > 0 ? `  (×${(Math.floor(mult * 100 + 1e-6) / 100).toLocaleString()})` : ''}`].join('\n'),
  ].join('\n\n');

  const embed = new EmbedBuilder()
    .setColor(tier === 'JACKPOT' ? COLOR.silver : tier === 'BIG WIN' ? COLOR.violet : COLOR.purple)
    .setDescription(desc.slice(0, 4096))
    .setFooter({ text: smart ? 'C4sino · Smart Move' : 'C4sino · Congrats' })
    .setTimestamp();
  if (a.userName) embed.setAuthor({ name: a.userName, iconURL: a.avatarUrl });
  if (a.avatarUrl) embed.setThumbnail(a.avatarUrl);
  return embed;
}
