// カジノ用語専用のランダム LEET 置換。
// 大文字・小文字それぞれ独自の候補セットを持つ。各候補には「元の文字そのまま」も含める。
// PayPay / LTC / User / Amount / Link / Address 等カジノ非関連語には適用しないこと。

const UPPER: Record<string, string[]> = {
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

const LOWER: Record<string, string[]> = {
  a: ['а', 'à', 'á', 'a'],
  b: ['b'],
  c: ['с', 'c'],
  d: ['d'],
  e: ['е', 'è', 'é', 'e'],
  f: ['ƒ', 'f'],
  g: ['ğ', 'g'],
  h: ['һ', 'h'],
  i: ['і', 'ì', 'í', 'i'],
  j: ['j'],
  k: ['к', 'k'],
  l: ['ł', 'ӏ', 'l'],
  m: ['м', 'm'],
  n: ['ñ', 'n'],
  o: ['о', 'ò', 'ó', 'o'],
  p: ['р', 'p'],
  q: ['q'],
  r: ['ř', 'r'],
  s: ['ѕ', 'š', 's'],
  t: ['т', 't'],
  u: ['ü', 'ù', 'ú', 'u'],
  v: ['v'],
  w: ['w'],
  x: ['х', 'x'],
  y: ['у', 'y'],
  z: ['ž', 'z'],
};

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** ラテンアルファベットを定義した候補からランダム置換。日本語/数字/記号はそのまま。 */
export function leet(s: string): string {
  let out = '';
  for (const ch of s) {
    const u = UPPER[ch];
    if (u) { out += pick(u); continue; }
    const l = LOWER[ch];
    if (l) { out += pick(l); continue; }
    out += ch;
  }
  return out;
}

export const L = leet;
