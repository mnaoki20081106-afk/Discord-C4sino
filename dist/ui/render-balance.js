// 残高ゲージ: テキストベース (Unicode ブロック) 版。
// 以前は @napi-rs/canvas で PNG を描画していたが、ネイティブバイナリ 60MB+ が
// MWS の 800MB 制限を圧迫するため canvas を廃止し、
// Discord の ``` code block ``` 内で等幅表示するテキストゲージに置き換えた。
const GAUGE_WIDTH = 24;
const FILL_CHAR = '█';
const EMPTY_CHAR = '░';
function bar(ratio) {
    const r = Math.max(0, Math.min(1, ratio));
    const filled = Math.round(GAUGE_WIDTH * r);
    return FILL_CHAR.repeat(filled) + EMPTY_CHAR.repeat(GAUGE_WIDTH - filled);
}
function fmtJpy(n) {
    return `¥${n.toLocaleString('ja-JP')}`;
}
function padRight(s, width) {
    // 全角文字を 2 幅として扱う簡易パディング
    let w = 0;
    for (const c of s)
        w += c.codePointAt(0) > 0x7f ? 2 : 1;
    return s + ' '.repeat(Math.max(0, width - w));
}
/**
 * 残高をテキストゲージとして組み立てる。Discord の ``` code block ``` に入れると
 * 等幅フォントで綺麗に並ぶ。
 */
export function formatBalanceText(input) {
    const { pp, ltc } = input;
    const total = pp + ltc;
    const ppPct = total > 0 ? pp / total : 0;
    const ltcPct = total > 0 ? ltc / total : 0;
    const lines = [];
    lines.push(`BALANCE   TOTAL ${fmtJpy(total)}`);
    lines.push('');
    lines.push(`PP    ${bar(ppPct)}  ${padRight(fmtJpy(pp), 12)} (${(ppPct * 100).toFixed(1)}%)`);
    lines.push(`LTC   ${bar(ltcPct)}  ${padRight(fmtJpy(ltc), 12)} (${(ltcPct * 100).toFixed(1)}%)`);
    return lines.join('\n');
}
