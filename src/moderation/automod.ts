import {
  Guild,
  AutoModerationRuleTriggerType,
  AutoModerationRuleEventType,
  AutoModerationActionType,
  AutoModerationRuleKeywordPresetType,
  PermissionFlagsBits,
  type AutoModerationActionOptions,
} from 'discord.js';
import { db } from '../db/schema.js';

db.exec(`CREATE TABLE IF NOT EXISTS automod_banned_words (
  guild_id   TEXT NOT NULL,
  word       TEXT NOT NULL,
  added_by   TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (guild_id, word)
);`);

// 初期 NG ワードを登録済みのサーバー。一度登録したら再登録しないので、削除した語は戻らない。
db.exec(`CREATE TABLE IF NOT EXISTS automod_seeded (
  guild_id  TEXT PRIMARY KEY,
  seeded_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);`);

/** 初期 NG ワード (DEFAULT_KEYWORDS) をそのサーバーの NG ワードとして一度だけ登録する。 */
function ensureSeeded(guildId: string): void {
  if (db.prepare('SELECT 1 FROM automod_seeded WHERE guild_id=?').get(guildId)) return;
  const ins = db.prepare('INSERT OR IGNORE INTO automod_banned_words(guild_id, word, added_by) VALUES (?,?,?)');
  db.transaction(() => {
    for (const w of DEFAULT_KEYWORDS) ins.run(guildId, w, 'system');
    db.prepare('INSERT INTO automod_seeded(guild_id) VALUES (?)').run(guildId);
  })();
}

export function listBannedWords(guildId: string): Array<{ word: string; added_by: string; created_at: number }> {
  ensureSeeded(guildId);
  return db.prepare('SELECT word, added_by, created_at FROM automod_banned_words WHERE guild_id=? ORDER BY created_at DESC, word')
    .all(guildId) as any;
}

export function addBannedWord(guildId: string, word: string, addedBy: string): { added: boolean; reason?: string } {
  const w = word.trim();
  if (!w) return { added: false, reason: '空の語は追加できません' };
  if (w.length > 60) return { added: false, reason: '60文字以下にしてください (Discord AutoMod 制約)' };
  ensureSeeded(guildId);
  const info = db.prepare('INSERT OR IGNORE INTO automod_banned_words(guild_id, word, added_by) VALUES (?,?,?)').run(guildId, w, addedBy);
  if (info.changes === 0) return { added: false, reason: '既に登録済みです' };
  return { added: true };
}

export function removeBannedWord(guildId: string, word: string): boolean {
  ensureSeeded(guildId);
  const info = db.prepare('DELETE FROM automod_banned_words WHERE guild_id=? AND word=?').run(guildId, word.trim());
  return info.changes > 0;
}

/** そのサーバーの NG ワード全件 (初期登録分を含む)。 */
export function getBannedKeywords(guildId: string): string[] {
  ensureSeeded(guildId);
  return (db.prepare('SELECT word FROM automod_banned_words WHERE guild_id=?').all(guildId) as Array<{word:string}>).map(r => r.word);
}

export const AUTOMOD_RULE_NAME = 'c4sino-ward';

// 各サーバーに最初に一度だけ登録する NG ワード。登録後はほかの語と同じく追加・削除できる。
// 頻出誤爆語 (例: "bet" が "better/between" に当たる) は keyword ではなく regex 側で境界付き制御する。
const DEFAULT_KEYWORDS: string[] = [
  // 代表語
  'カジノ', 'casino',
  'ギャンブル', 'gamble', 'gambling',
  '賭博', 'ばくち', '博打',
  // ゲーム名
  'ブラックジャック', 'blackjack',
  'スロット', 'slots',
  'ルーレット', 'roulette',
  'バカラ', 'baccarat',
  'ビデオポーカー', 'videopoker', 'video poker',
  'クラップス', 'craps',
  // ベット/配当語
  'ベット', '賭け', '賭ける',
  'ジャックポット', 'jackpot',
  'ペイアウト', 'payout',
  'ハウスエッジ',
  // 支払い/チップ
  'paypay', 'ペイペイ',
  'litecoin', 'ライトコイン',
  '送金リンク',
  '入金', '出金', 'チャージ',
  // Bot / サービス固有
  'c4sino', 'ccasino', 'キャシノ',
];

// 伏字/区切り挿入パターン (regex, 10本まで, 1本260字以内, Rust regex, (?i) で case-insensitive)
const REGEXES: string[] = [
  // カジノ 変種: カ◯ジ〇ノ / カ_ジ-ノ / カ ジ ノ / カ.ジ.ノ etc.
  'カ[\\s\\p{P}\\p{S}ー_＿．.・•●○◯〇\\-ｰ]{0,3}ジ[\\s\\p{P}\\p{S}ー_＿．.・•●○◯〇\\-ｰ]{0,3}ノ',
  // casino 変種 (英字区切り / leet): c a s i n o / c-a-s-i-n-o / c4sino / cas1no
  '(?i)c[\\s\\p{P}\\p{S}_\\-]{0,2}[a4@][\\s\\p{P}\\p{S}_\\-]{0,2}s[\\s\\p{P}\\p{S}_\\-]{0,2}[i1!|][\\s\\p{P}\\p{S}_\\-]{0,2}n[\\s\\p{P}\\p{S}_\\-]{0,2}o',
  // ギャンブル 変種
  'ギ[\\s\\p{P}\\p{S}ー_＿]{0,2}ャ[\\s\\p{P}\\p{S}ー_＿]{0,2}ン[\\s\\p{P}\\p{S}ー_＿]{0,2}ブ[\\s\\p{P}\\p{S}ー_＿]{0,2}ル',
  // スロット 変種
  'ス[\\s\\p{P}\\p{S}ー_＿]{0,2}ロ[\\s\\p{P}\\p{S}ー_＿]{0,2}ッ?[\\s\\p{P}\\p{S}ー_＿]{0,2}ト',
  // ルーレット 変種
  'ル[\\s\\p{P}\\p{S}ー_＿]{0,2}ー?[\\s\\p{P}\\p{S}ー_＿]{0,2}レ[\\s\\p{P}\\p{S}ー_＿]{0,2}ッ?[\\s\\p{P}\\p{S}ー_＿]{0,2}ト',
  // バカラ 変種
  'バ[\\s\\p{P}\\p{S}ー_＿]{0,2}カ[\\s\\p{P}\\p{S}ー_＿]{0,2}ラ',
  // 賭 (1文字でも含んだら) に続いて関連語
  '(?:賭|か)け[\\s]?(?:事|金|る|て|た|ろ)',
  // 送金 / 入出金 の組み合わせ
  '(?:送金|入金|出金)[\\s\\p{P}]{0,3}(?:リンク|url|URL|ID|額)',
  // paypay / ペイペイ 変種
  '(?i)p[\\s\\p{P}\\p{S}_\\-]{0,2}a[\\s\\p{P}\\p{S}_\\-]{0,2}y[\\s\\p{P}\\p{S}_\\-]{0,2}p[\\s\\p{P}\\p{S}_\\-]{0,2}a[\\s\\p{P}\\p{S}_\\-]{0,2}y',
  // blackjack / bj 変種
  '(?i)b[\\s\\p{P}\\p{S}_\\-]{0,2}l?[\\s\\p{P}\\p{S}_\\-]{0,2}a[\\s\\p{P}\\p{S}_\\-]{0,2}c?k?[\\s\\p{P}\\p{S}_\\-]{0,2}j[\\s\\p{P}\\p{S}_\\-]{0,2}a[\\s\\p{P}\\p{S}_\\-]{0,2}c[\\s\\p{P}\\p{S}_\\-]{0,2}k',
];

// 伏字 (ユーザーが指示されたら使うべき形) は allow_list に入れない。
// 誤爆回避の除外語だけ列挙する。
const ALLOW_LIST: string[] = [
  // 一般名詞/固有名詞の誤爆回避
  'カジノロワイヤル', 'カジノ・ロワイヤル',
];

const CUSTOM_MESSAGE =
  'このサーバーではその語は送信できません。伏字 (例: カ◯ジノ, s|ots, ルー◯ット) を使ってください。';

const ACTIONS: AutoModerationActionOptions[] = [
  {
    type: AutoModerationActionType.BlockMessage,
    metadata: { customMessage: CUSTOM_MESSAGE },
  },
];

export interface AutoModSyncResult {
  action: 'created' | 'updated' | 'noop' | 'skipped';
  reason?: string;
  ruleId?: string;
}

/**
 * 指定 Guild に AutoMod rule を upsert する。
 * - 既存の同名 rule があれば update、無ければ create
 * - Bot の権限 (ManageGuild) が無ければ skipped を返す
 * - 例外は呼び出し元で扱えるよう re-throw する (sync コマンドでユーザーに見せる)
 */

export async function syncGuildAutoMod(
  guild: Guild,
  opts?: { exemptRoleIds?: string[]; exemptChannelIds?: string[]; extraKeywords?: string[] }
): Promise<AutoModSyncResult> {
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!me) return { action: 'skipped', reason: 'bot member not resolvable' };
  if (!me.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return { action: 'skipped', reason: 'bot lacks ManageGuild' };
  }

  const rules = await guild.autoModerationRules.fetch().catch(() => null);
  if (!rules) return { action: 'skipped', reason: 'failed to fetch rules' };

  const existing = rules.find(r => r.name === AUTOMOD_RULE_NAME);

  const common = {
    name: AUTOMOD_RULE_NAME,
    eventType: AutoModerationRuleEventType.MessageSend,
    triggerType: AutoModerationRuleTriggerType.Keyword,
    triggerMetadata: {
      keywordFilter: mergeKeywords(opts?.extraKeywords ?? []),
      regexPatterns: REGEXES,
      allowList: ALLOW_LIST,
      presets: [] as AutoModerationRuleKeywordPresetType[],
    },
    actions: ACTIONS,
    enabled: true,
    exemptRoles: opts?.exemptRoleIds ?? [],
    exemptChannels: opts?.exemptChannelIds ?? [],
    reason: 'c4sino word guard sync',
  };

  if (!existing) {
    const r = await guild.autoModerationRules.create(common);
    return { action: 'created', ruleId: r.id };
  }
  const r = await existing.edit(common);
  return { action: 'updated', ruleId: r.id };
}

export async function syncAllGuilds(
  client: { guilds: { cache: Map<string, Guild> } },
  resolveExtra?: (guildId: string) => string[]
): Promise<void> {
  for (const g of client.guilds.cache.values()) {
    try {
      const extra = resolveExtra?.(g.id) ?? [];
      const r = await syncGuildAutoMod(g, { extraKeywords: extra });
      console.log(`[automod] ${g.id} (${g.name}): ${r.action}${r.reason ? ` — ${r.reason}` : ''}${r.ruleId ? ` [${r.ruleId}]` : ''}`);
    } catch (e) {
      console.error(`[automod] ${g.id} sync failed:`, (e as Error).message);
    }
  }
}

/**
 * 以前に設置した AutoMod ブロックルールを削除する。Webhook rewrite 方式に切り替えると
 * AutoMod が先に発火してメッセージが届かないため、起動時にクリーンアップする。
 */
export async function removeGuildAutoMod(guild: Guild): Promise<boolean> {
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!me?.permissions.has(PermissionFlagsBits.ManageGuild)) return false;
  const rules = await guild.autoModerationRules.fetch().catch(() => null);
  if (!rules) return false;
  const existing = rules.find(r => r.name === AUTOMOD_RULE_NAME);
  if (!existing) return false;
  await existing.delete('c4sino: switched to webhook rewrite mode').catch(() => {});
  return true;
}

export async function removeAutoModInAllGuilds(client: { guilds: { cache: Map<string, Guild> } }): Promise<void> {
  for (const g of client.guilds.cache.values()) {
    try {
      const removed = await removeGuildAutoMod(g);
      if (removed) console.log(`[automod] removed legacy rule in ${g.id} (${g.name})`);
    } catch (e) {
      console.warn(`[automod] remove failed in ${g.id}:`, (e as Error).message);
    }
  }
}

// lowercase 比較で重複排除し、1000個・60字制限に収める。
function mergeKeywords(words: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    const t = w.trim();
    if (!t || t.length > 60) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= 1000) break;
  }
  return out;
}
