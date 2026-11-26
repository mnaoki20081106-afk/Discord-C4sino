/**
 * パネルの見た目の共通部品。色は 黒 / シルバー / 紫 / 青紫 の 4 色だけを使う。
 *
 * Discord の embed は、タイトル・項目名・フッターではアプリ絵文字が表示されない。
 * そのため見出しや区切りはすべて本文 (description) に書く。
 */
import { EmbedBuilder } from 'discord.js';
import { emoji } from './emoji-ids.js';

export const COLOR = {
  black:  0x0b0b12,
  silver: 0xb8b8c4,
  purple: 0x7c3aed,
  violet: 0x4f46e5,   // 紫寄りの青
} as const;

/** 絵文字。未登録なら代わりの文字 (無ければ空)。 */
export const e = (name: string, fallback = '') => emoji(name) || fallback;

export const ICON = {
  fire:    () => e('deco_fire'),
  crown:   () => e('ui_crown', '◆'),
  arrow:   () => e('ui_arrow', '▸'),
  sparkle: () => e('ui_sparkle'),
  check:   () => e('ui_check', '✓'),
  chip:    () => e('ui_chip'),
  wallet:  () => e('ui_wallet'),
  balance: () => e('ui_balance'),
  paypay:  () => e('pay_paypay'),
  ltc:     () => e('pay_ltc'),
} as const;

export const GAME_ICON: Record<string, () => string> = {
  blackjack:  () => e('game_blackjack'),
  slots:      () => e('game_slots'),
  roulette:   () => e('game_roulette'),
  baccarat:   () => e('game_baccarat'),
  videopoker: () => e('game_videopoker'),
  craps:      () => e('game_craps'),
  mines:      () => e('game_mines'),
};

export interface Section {
  /** 見出しの前に付ける絵文字 (無ければ王冠) */
  icon?: string;
  title: string;
  lines: string[];
}

/** 箇条書き 1 行 */
export const bullet = (s: string) => `${ICON.arrow()} ${s}`;

/**
 * 全パネル共通の組み立て:
 *   # (アイコン) 名前
 *   (炎) ひとこと (炎)
 *   ### (印) 見出し
 *   (矢印) 箇条書き …
 */
export function panelEmbed(opts: {
  icon: string;
  title: string;
  tagline: string;
  sections: Section[];
  color?: number;
  footer?: string;
  /** 箇条書きの印。既定は紫の矢印 (管理画面はシルバーの菱形) */
  bullet?: string;
  /** ひとことの両脇の飾り。既定は炎、'' で飾りなし */
  deco?: string;
}): EmbedBuilder {
  const deco = opts.deco ?? ICON.fire();
  const mark = opts.bullet ?? ICON.arrow();
  const head = [
    `# ${opts.icon ? `${opts.icon} ` : ''}${opts.title}`,
    deco ? `${deco} ${opts.tagline} ${deco}` : opts.tagline,
  ];
  const body = opts.sections.map(s =>
    [`### ${s.icon ?? ICON.crown()} ${s.title}`, ...s.lines.map(line => `${mark} ${line}`)].join('\n'));
  const embed = new EmbedBuilder()
    .setColor(opts.color ?? COLOR.purple)
    .setDescription([head.join('\n'), ...body].join('\n\n').slice(0, 4096));
  if (opts.footer) embed.setFooter({ text: opts.footer });
  return embed;
}
