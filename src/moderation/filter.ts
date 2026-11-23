import {
  Client, Events, Message, TextChannel, NewsChannel, ThreadChannel,
  Webhook, PermissionFlagsBits, ChannelType,
} from 'discord.js';
import { L } from '../ui/leet.js';
import { getBannedKeywords } from './automod.js';

const WEBHOOK_NAME = 'c4sino-filter';
const JA_MASK = '◯';

const webhookCache = new Map<string, Webhook>();

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasLatin(s: string): boolean { return /[A-Za-z]/.test(s); }

/**
 * 1 語を伏字化:
 *   - ラテン文字を含むなら L() (Unicode lookalike randomize)
 *   - 日本語/漢字など非ラテンなら中央 1 文字を ◯ に差し替え
 *   - 混在ならどちらも適用
 */
export function obfuscate(word: string): string {
  const arr = Array.from(word); // サロゲートペア安全
  if (arr.length === 0) return word;

  let result: string;
  if (hasLatin(word)) {
    result = L(word);
  } else {
    result = word;
  }

  // 非ラテン語を含むなら中央を覆面文字に
  if (!hasLatin(word) && arr.length >= 2) {
    const mid = Math.floor(arr.length / 2);
    const masked = [...arr];
    masked[mid] = JA_MASK;
    result = masked.join('');
  }
  return result;
}

function buildWordRegex(word: string): RegExp {
  const esc = escapeRegex(word);
  // ラテンのみ → 単語境界で囲んで誤爆回避 + 大小区別なし
  if (hasLatin(word) && /^[A-Za-z0-9]+$/.test(word)) {
    return new RegExp(`\\b${esc}\\b`, 'gi');
  }
  // それ以外 (日本語含む) → そのまま (境界概念なし)
  return new RegExp(esc, 'g');
}

export function rewriteContent(content: string, words: string[]): { changed: boolean; content: string } {
  let result = content;
  let changed = false;
  for (const word of words) {
    if (!word) continue;
    const re = buildWordRegex(word);
    result = result.replace(re, (m) => {
      changed = true;
      return obfuscate(m);
    });
  }
  return { changed, content: result };
}

type WebhookTarget = {
  webhook: Webhook;
  /** スレッド宛て投稿用 (threadId を指定する) */
  threadId?: string;
};

async function resolveWebhookTarget(client: Client, msg: Message): Promise<WebhookTarget | null> {
  const ch = msg.channel;
  if (!ch) return null;

  // スレッドの場合は親チャンネルの webhook を使い threadId を付ける
  if (ch.isThread()) {
    const parent = (ch as ThreadChannel).parent;
    if (!parent || !(parent instanceof TextChannel || parent instanceof NewsChannel)) return null;
    const wh = await getOrCreateWebhook(parent);
    return wh ? { webhook: wh, threadId: ch.id } : null;
  }
  if (ch instanceof TextChannel || ch instanceof NewsChannel) {
    const wh = await getOrCreateWebhook(ch);
    return wh ? { webhook: wh } : null;
  }
  return null;
}

async function getOrCreateWebhook(channel: TextChannel | NewsChannel): Promise<Webhook | null> {
  const cached = webhookCache.get(channel.id);
  if (cached) return cached;
  const me = channel.guild.members.me;
  if (!me?.permissionsIn(channel).has(PermissionFlagsBits.ManageWebhooks)) {
    console.warn(`[filter] no ManageWebhooks in ${channel.guild.name}#${channel.name}`);
    return null;
  }
  try {
    const hooks = await channel.fetchWebhooks();
    const mine = hooks.find(h => h.name === WEBHOOK_NAME && h.owner?.id === channel.client.user!.id);
    if (mine) { webhookCache.set(channel.id, mine); return mine; }
    const created = await channel.createWebhook({ name: WEBHOOK_NAME, reason: 'c4sino filter rewrite' });
    webhookCache.set(channel.id, created);
    return created;
  } catch (e) {
    console.error(`[filter] webhook resolve failed in #${channel.id}:`, (e as Error).message);
    return null;
  }
}

/**
 * messageCreate ハンドラ。NG 語を含むメッセージを削除し、Webhook で伏字化版を
 * 元投稿者の名前/アイコンで再投稿する。
 */
export function installFilter(client: Client) {
  client.on(Events.MessageCreate, async (msg) => {
    try {
      if (!msg.guild) return;                     // DM 無視
      if (msg.author.bot) return;                 // bot / webhook は無視 (ループ防止)
      if (msg.webhookId) return;                  // webhook 投稿も無視
      if (msg.system) return;
      if (!msg.content) return;                   // 添付のみ投稿は対象外

      const words = getBannedKeywords(msg.guild.id);
      const { changed, content } = rewriteContent(msg.content, words);
      if (!changed) return;

      const me = msg.guild.members.me;
      if (!me?.permissionsIn(msg.channel as any).has(PermissionFlagsBits.ManageMessages)) {
        console.warn(`[filter] no ManageMessages in #${msg.channelId}`);
        return;
      }

      const target = await resolveWebhookTarget(client, msg);
      if (!target) return;

      // 元を削除 → webhook で送信
      await msg.delete().catch((e) => {
        console.warn(`[filter] delete failed: ${(e as Error).message}`);
      });

      const displayName = msg.member?.displayName ?? msg.author.username;
      // 避難: Discord / Clyde 予約名を使うとエラーになる
      const safeName = displayName.replace(/discord|clyde/gi, '*');
      await target.webhook.send({
        content: content.slice(0, 2000),
        username: safeName.slice(0, 80),
        avatarURL: msg.author.displayAvatarURL({ size: 256 }),
        threadId: target.threadId,
        allowedMentions: { parse: [] },           // 新規 ping を発生させない
        files: msg.attachments.map(a => ({ attachment: a.url, name: a.name })),
      });
    } catch (e) {
      console.error('[filter] handler error:', (e as Error).message);
    }
  });
}
