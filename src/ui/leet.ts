// カジノ用語専用のランダム LEET 置換。
// 各文字について、下記候補からランダムで1つ選ぶ。候補には「元の文字そのまま」も必ず含める。
// PayPay / LTC / User / Amount / Link / Address 等カジノ非関連語には適用しないこと。

const MAP: Record<string, string[]> = {
  A: ['А', 'Α', 'À', 'Á', 'A'],
  B: ['Β', 'В', 'ß', 'B'],
  C: ['Ϲ', 'С', 'Ç', 'C'],
  D: ['Ð', 'D'],
  E: ['Ε', 'Е', 'È', 'É', 'E'],
  F: ['Ƒ', 'F'],
  G: ['Ğ', 'G'],
  H: ['Η', 'Н', 'Ĥ', 'H'],
  I: ['Ι', 'І', 'Ì', 'Í', 'I'],
  J: ['Ĵ', 'J'],
  K: ['Κ', 'К', 'Ķ', 'K'],
  L: ['Ł', 'L'],
  M: ['М', 'Μ', 'M'],
  N: ['Ν', 'Ñ', 'N'],
  O: ['О', 'Ο', 'Ò', 'Ó', 'O'],
  P: ['Ρ', 'Р', 'Þ', 'P'],
  Q: ['Q'],
  R: ['Ř', 'R'],
  S: ['Ѕ', 'Š', 'S'],
  T: ['Τ', 'Т', 'Ť', 'T'],
  U: ['Ü', 'Ù', 'Ú', 'U'],
  V: ['V'],
  W: ['Ŵ', 'W'],
  X: ['Χ', 'Х', 'X'],
  Y: ['Υ', 'Ý', 'Y'],
  Z: ['Ζ', 'Ž', 'Z'],
};

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** 文字列中のラテンアルファベットを定義した候補からランダム置換。小文字は大文字候補を小文字化。それ以外(日本語/数字/記号)はそのまま。 */
export function leet(s: string): string {
  let out = '';
  for (const ch of s) {
    const upper = ch.toUpperCase();
    const cands = MAP[upper];
    if (!cands) { out += ch; continue; }
    const r = pick(cands);
    out += ch === upper ? r : r.toLowerCase();
  }
  return out;
}

/** 複数の語をまとめて置換する便利関数 */
export const L = leet;
