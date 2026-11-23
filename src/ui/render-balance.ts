// 残高ゲージ: テキストベース (Unicode ブロック) 版。
// 以前は @napi-rs/canvas で PNG を描画していたが、ネイティブバイナリ 60MB+ が
// MWS の 800MB 制限を圧迫するため canvas を廃止し、
// Discord の ``` code block ``` 内で等幅表示するテキストゲージに置き換えた。

export interface BalanceRenderInput {
  pp: number;
  ltc: number;
  /** 任意の注記 (例: 入金完了後のメッセージ) */
  note?: string;
}

const GAUGE_WIDTH = 24;
const FILL_CHAR = '█';
const EMPTY_CHAR = '░';

function bar(ratio: number): string {
  const r = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(GAUGE_WIDTH * r);
  return FILL_CHAR.repeat(filled) + EMPTY_CHAR.repeat(GAUGE_WIDTH - filled);
}

function fmtJpy(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`;
}

function padRight(s: string, width: number): string {
  // 全角文字を 2 幅として扱う簡易パディング
  let w = 0;
  for (const c of s) w += c.codePointAt(0)! > 0x7f ? 2 : 1;
  return s + ' '.repeat(Math.max(0, width - w));
}

/**
 * 残高をテキストゲージとして組み立てる。Discord の ``` code block ``` に入れると
 * 等幅フォントで綺麗に並ぶ。
 */
export function formatBalanceText(input: BalanceRenderInput): string {
  const { pp, ltc } = input;
  const total = pp + ltc;
  const ppPct = total > 0 ? pp / total : 0;
  const ltcPct = total > 0 ? ltc / total : 0;

  const lines: string[] = [];
  lines.push(`BALANCE   TOTAL ${fmtJpy(total)}`);
  lines.push('');
  lines.push(`PP    ${bar(ppPct)}  ${padRight(fmtJpy(pp), 12)} (${(ppPct * 100).toFixed(1)}%)`);
  lines.push(`LTC   ${bar(ltcPct)}  ${padRight(fmtJpy(ltc), 12)} (${(ltcPct * 100).toFixed(1)}%)`);

  return lines.join('\n');
}
