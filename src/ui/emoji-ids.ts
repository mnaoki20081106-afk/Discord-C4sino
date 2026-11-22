// Stub — Discord Application Emoji の ID 辞書。
// 実アップロード前は空。`node scripts/upload-emojis.mjs` 実行後に name→id が埋まる。

export const EMOJI_IDS = {} as Record<string, string>;

export type EmojiName = string;

/** `<:name:id>` 形式の Discord 絵文字タグを返す。存在しない name は空文字。 */
export function emoji(name: string): string {
  const id = EMOJI_IDS[name];
  return id ? `<:${name}:${id}>` : '';
}
