import { Client, EmbedBuilder, GuildTextBasedChannel } from 'discord.js';
import { db } from './db/schema.js';
import { L } from './ui/leet.js';

export interface AchievementRecord {
  guildId: string;
  discordId: string;
  game: 'blackjack' | 'slots';
  bet: number;
  payout: number;
  net: number;
}

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

// ───────── 実績通知 Embed を送る ─────────
export async function announce(client: Client, a: AchievementRecord): Promise<void> {
  const cfg = getConfig(a.guildId);
  if (!cfg.channelId) return;
  const ch = await client.channels.fetch(cfg.channelId).catch(() => null);
  if (!ch || !('send' in ch)) return;

  const mult = a.bet > 0 ? a.payout / a.bet : 0;
  const tier = a.game === 'slots'
    ? (mult >= 2000 ? 'JACKPOT' : mult >= 200 ? 'BIG WIN' : 'WIN')
    : (a.net >= a.bet * 4 ? 'BIG WIN' : 'WIN');
  const color = tier === 'JACKPOT' ? 0xffd93d : tier === 'BIG WIN' ? 0xf59e0b : 0x22c55e;

  const emoji = a.game === 'slots' ? '🎰' : '🂡';
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${emoji}  ${L(tier)}  !!`)
    .setDescription(`<@${a.discordId}> が **${L(a.game === 'blackjack' ? 'Blackjack' : 'Slots')}** で当選`)
    .addFields(
      { name: L('BET'),    value: `${a.bet.toLocaleString()} ${L('chips')}`, inline: true },
      { name: L('Payout'), value: `${a.payout.toLocaleString()} ${L('chips')}`, inline: true },
      { name: '純利',       value: `+${a.net.toLocaleString()} ${L('chips')}`, inline: true },
      ...(mult > 0 ? [{ name: 'Mult', value: `×${mult.toFixed(2)}`, inline: true }] : []),
    )
    .setTimestamp();

  await (ch as any).send({ embeds: [embed] });

  if (cfg.baseName) scheduleRename(client, a.guildId, cfg.channelId, cfg.baseName);
}
