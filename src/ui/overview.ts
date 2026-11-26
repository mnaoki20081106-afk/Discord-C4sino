/**
 * ゲームと入出金の説明文。チャンネルに置くパネル (publicGamePanel / depositPanel) と、
 * ゲーム管理パネルで設置するルール説明パネルは、どちらもここの中身を theme.panelEmbed で組み立てる。
 * 数字はゲームのコード (src/games/*, src/payments/limits.ts) と一致させること。
 */
import type { EmbedBuilder } from 'discord.js';
import { SYMBOLS } from '../games/slots.js';
import { multiplier as minesMult, HOUSE_EDGE as MINES_EDGE } from '../games/mines.js';
import { MIN_DEPOSIT_JPY, MIN_WITHDRAW_JPY, MIN_BET_CHIPS, MAX_BET_CHIPS, LTC_NETWORK_FEE_JPY } from '../payments/limits.js';
import { L } from './leet.js';
import { slotEmoji } from './format-games.js';
import { COLOR, GAME_ICON, ICON, panelEmbed, type Section } from './theme.js';

export type GameKey = 'blackjack' | 'slots' | 'roulette' | 'baccarat' | 'videopoker' | 'craps' | 'mines' | 'cashier' | 'all';
type Game = Exclude<GameKey, 'cashier' | 'all'>;

/** スロットの実 RTP を重みから計算 */
export function computeSlotsRTP() {
  const total = SYMBOLS.reduce((s, x) => s + x.w, 0);
  const p: Record<string, number> = {};
  for (const s of SYMBOLS) p[s.id] = s.w / total;

  let rtp3 = 0;
  const lines3: Array<{ sym: string; prob: number; pay: number; ret: number }> = [];
  for (const s of SYMBOLS) {
    const prob = p[s.id] ** 3;
    const ret = prob * s.pay3;
    rtp3 += ret;
    lines3.push({ sym: s.id, prob, pay: s.pay3, ret });
  }

  const pc = p['🍒'];
  const cherry = SYMBOLS[0];
  const prob2c = pc * pc * (1 - pc);
  const ret2c = prob2c * cherry.pay2;
  const rtp = rtp3 + ret2c;

  return { rtp, rtp3, ret2c, prob2c, lines3, totalWeight: total };
}

const yen = (n: number) => `¥${n.toLocaleString()}`;
const pct = (x: number, d = 2) => `${(x * 100).toFixed(d)}%`;

const NAME: Record<Game, string> = {
  blackjack: L('BLACKJACK'), slots: L('SLOTS'), roulette: L('ROULETTE'),
  baccarat: L('BACCARAT'), videopoker: L('VIDEO POKER'), craps: L('CRAPS'), mines: L('MINES'),
};

const betRange = (g: Game) => `BET ${yen(MIN_BET_CHIPS[g])} 〜 ${yen(MAX_BET_CHIPS[g])}${g === 'craps' ? ' (1 つの賭けごと)' : ''}`;

interface GameInfo {
  tagline: string;
  rules: string[];
  payouts: string[];
  /** ルール説明パネルだけに出す確率 */
  odds?: string[];
  /** 還元率など (BET 範囲の下に出す) */
  rtp: string[];
  /** チャンネルのパネルに出す遊び方 */
  howto: string[];
}

const HOWTO_TABLE = [
  'PLAY で自分専用のテーブルが開く',
  'BET 額を決めて BET。次からは BET を押すだけ',
  '½・2×・金額変更で BET 額を調整',
];

function info(g: Game): GameInfo {
  switch (g) {
    case 'blackjack': return {
      tagline: 'ディーラーより 21 に近づけたら勝ち',
      rules: [
        '6 デッキ。毎ゲーム暗号学的乱数でシャッフル',
        'ディーラーはソフト 17 でもヒット (H17)',
        'ダブルは最初の 2 枚のときだけ',
        'スプリットは同じ数字の 2 枚で、最大 4 ハンドまで',
        'インシュランス・サレンダーはなし',
      ],
      payouts: ['ブラックジャック **×2.5**', '勝ち **×2**', '引き分け **×1** (BET 返却)'],
      rtp: ['還元率 約 **99.5%** (基本戦略どおりに打った場合の参考値)'],
      howto: HOWTO_TABLE,
    };
    case 'slots': {
      const r = computeSlotsRTP();
      const hit = r.lines3.reduce((s, l) => s + l.prob, 0) + r.prob2c;
      const jackpot = (SYMBOLS[SYMBOLS.length - 1].w / r.totalWeight) ** 3;
      const cherry = slotEmoji(SYMBOLS[0]);
      return {
        tagline: '同じ絵柄が 3 つそろえば当たり',
        rules: ['3 リール。各リールは独立して止まる', `左 2 つが ${cherry} でも当たり`],
        payouts: [
          ...[...SYMBOLS].sort((a, b) => b.pay3 - a.pay3).map(s => `${slotEmoji(s).repeat(3)}  **×${s.pay3.toLocaleString()}**`),
          `${cherry}${cherry} + 何でも  **×${SYMBOLS[0].pay2}**`,
        ],
        odds: [
          `当たり 約 **${(1 / hit).toFixed(1)} 回に 1 回** (${pct(hit)})`,
          `${slotEmoji(SYMBOLS[SYMBOLS.length - 1]).repeat(3)} 約 **${Math.round(1 / jackpot).toLocaleString()} 回に 1 回**`,
        ],
        rtp: [`還元率 **${pct(r.rtp)}** (配当と出現率から計算)`],
        howto: HOWTO_TABLE,
      };
    }
    case 'roulette': return {
      tagline: '0〜36 のどこにボールが止まるかを当てる',
      rules: ['ヨーロピアン (0 が 1 つだけ)', '掛け方はテーブルで選ぶ'],
      payouts: [
        '赤 / 黒 / 奇数 / 偶数 / 1–18 / 19–36  **×2**',
        'ダズン (1–12 / 13–24 / 25–36)  **×3**',
        '数字 1 つ (0〜36)  **×36**',
      ],
      odds: [`×2 の掛け方 **${pct(18 / 37)}**`, `ダズン **${pct(12 / 37)}**`, `数字 1 つ **${pct(1 / 37)}**`],
      rtp: [`還元率 **${pct(36 / 37)}** (どの掛け方も同じ)`],
      howto: HOWTO_TABLE,
    };
    case 'baccarat': return {
      tagline: 'Player と Banker、9 に近い方を当てる',
      rules: [
        '6 デッキ。標準ルール (Punto Banco)',
        '合計は下 1 桁 (14 → 4)。8・9 はナチュラルでそこで決着',
        '3 枚目は標準の引きルールで自動',
        'タイのときは Player・Banker への BET は返金',
      ],
      payouts: ['Player **×2**', 'Banker **×1.95** (5% 手数料)', 'Tie **×9**'],
      odds: ['Player 勝ち **44.62%**', 'Banker 勝ち **45.86%**', 'Tie **9.52%**'],
      rtp: ['還元率 Banker **98.94%** / Player **98.76%** / Tie **85.6%**'],
      howto: HOWTO_TABLE,
    };
    case 'videopoker': return {
      tagline: '5 枚で役を作る。Jacks or Better',
      rules: ['最初に 5 枚配られる', '残すカードを HOLD して、DRAW で 1 回だけ引き直す', 'J 以上のワンペアから当たり'],
      payouts: [
        'ロイヤルフラッシュ **×800**', 'ストレートフラッシュ **×50**', 'フォーカード **×25**',
        'フルハウス **×9**', 'フラッシュ **×6**', 'ストレート **×4**',
        'スリーカード **×3**', 'ツーペア **×2**', 'J 以上のワンペア **×1**',
      ],
      rtp: ['還元率 **99.54%** (最適な打ち方をした場合)'],
      howto: [HOWTO_TABLE[0], 'BET → 残すカードを HOLD → DRAW', HOWTO_TABLE[2]],
    };
    case 'craps': return {
      tagline: '2 つのサイコロの合計で勝負',
      rules: [
        'カムアウト: 7・11 で Pass 勝ち / 2・3・12 で負け / それ以外はポイント成立',
        'ポイント中: ポイントが先に出れば Pass 勝ち、7 が先なら負け',
        '1 つの台に複数の賭けを置ける',
      ],
      payouts: [
        "Pass / Don't Pass / Come / Don't Come  **×2**",
        'Odds  **真の確率どおり** (ハウスエッジなし)',
        'Place 4・10 **×2.8** / 5・9 **×2.4** / 6・8 **×2.17**',
        'Hard 4・10 **×8** / Hard 6・8 **×10**',
        'Field **×2** (2・12 は **×3**)',
        'Any 7 **×5** / Any Craps **×8** / Yo 11 **×16** / 2・12 **×31**',
      ],
      rtp: ["主な還元率: Pass **98.59%** / Don't Pass **98.64%** / Place 6・8 **98.48%** / Field **97.22%** / Any 7 **83.33%**"],
      howto: ['PLAY で自分専用の台が開く', '賭けの種類を選ぶと、今の BET 額で台に置かれる', 'ROLL でサイコロを振る'],
    };
    case 'mines': {
      const x = (size: number, mines: number, k: number) => `×${minesMult(size, mines, k).toLocaleString()}`;
      return {
        tagline: '爆弾を避けて宝石のマスを開ける。開けるほど倍率アップ',
        rules: [
          'マスの数 (3×3 / 4×4) と爆弾の数を選んで BET',
          '宝石のマスを開けるたびに倍率が上がる',
          '好きなときに CASH OUT すると、その時点の倍率で払い戻し',
          '爆弾を開けたら BET は没収。宝石を全部開けたら自動で CASH OUT',
        ],
        payouts: [
          `倍率 = 確率どおりの倍率 × ${1 - MINES_EDGE} (小数 2 桁で切り捨て)`,
          `4×4・爆弾 3: 1 マス **${x(4, 3, 1)}** / 3 マス **${x(4, 3, 3)}** / 6 マス **${x(4, 3, 6)}**`,
          `4×4・爆弾 8: 1 マス **${x(4, 8, 1)}** / 3 マス **${x(4, 8, 3)}** / 全部 **${x(4, 8, 8)}**`,
          `3×3・爆弾 1: 1 マス **${x(3, 1, 1)}** / 4 マス **${x(3, 1, 4)}** / 全部 **${x(3, 1, 8)}**`,
        ],
        odds: ['1 マス目が宝石の確率 = 宝石のマス ÷ 全マス', `例: 4×4・爆弾 3 は **${pct(13 / 16)}** / 3×3・爆弾 1 は **${pct(8 / 9)}**`],
        rtp: [`還元率 **${pct(1 - MINES_EDGE, 0)}** 以下 (どこで CASH OUT しても同じ。切り捨てでわずかに下がる)`],
        howto: ['PLAY で自分専用のテーブルが開く', 'マスの数と爆弾の数を選んで BET', 'マスを開けて、好きなときに CASH OUT'],
      };
    }
  }
}

const depositLines = () => [
  `${ICON.paypay()} PayPay **${yen(MIN_DEPOSIT_JPY.paypay)}** 〜`,
  `${ICON.ltc()} LTC **${yen(MIN_DEPOSIT_JPY.ltc)}** 〜`,
];

/** チャンネルに置くゲームのパネル (ボタンは panels.ts で付ける) */
export function gamePanelEmbed(g: Game): EmbedBuilder {
  const x = info(g);
  return panelEmbed({
    icon: GAME_ICON[g](), title: NAME[g], tagline: x.tagline, footer: `C4sino · ${NAME[g]}`,
    sections: [
      { title: 'ルール', lines: x.rules },
      { icon: ICON.chip(), title: '配当', lines: x.payouts },
      { icon: ICON.balance(), title: 'BET と還元率', lines: [betRange(g), ...x.rtp] },
      { icon: ICON.sparkle(), title: '遊び方', lines: x.howto },
    ],
  });
}

/** ルール説明パネル (ゲーム管理パネルから設置) */
export function gameOverview(game: GameKey): EmbedBuilder {
  if (game === 'cashier') return cashierEmbed('C4sino · 入出金のルール');
  if (game === 'all') return allOverview();
  const x = info(game);
  const sections: Section[] = [
    { title: 'ルール', lines: x.rules },
    { icon: ICON.chip(), title: '配当', lines: x.payouts },
  ];
  if (x.odds) sections.push({ icon: ICON.sparkle(), title: '確率', lines: x.odds });
  sections.push(
    { icon: ICON.balance(), title: 'BET と還元率', lines: [betRange(game), ...x.rtp] },
    { icon: ICON.wallet(), title: '最低入金額', lines: depositLines() },
  );
  return panelEmbed({ icon: GAME_ICON[game](), title: NAME[game], tagline: x.tagline, sections, footer: `C4sino · ${NAME[game]} のルール` });
}

/** 入出金のパネル (Cashier) と、そのルール説明 */
export function cashierEmbed(footer = 'C4sino · Cashier'): EmbedBuilder {
  return panelEmbed({
    icon: ICON.wallet(), title: L('CASHIER'), tagline: '1 chip = ¥1。入金して遊び、勝った分は出金', color: COLOR.violet, footer,
    sections: [
      { icon: ICON.balance(), title: '残高のしくみ', lines: [
        '1 chip = ¥1。入金で増え、出金で減る',
        '残高は PayPay 由来 と LTC 由来 に分けて管理',
        '出金は、入金した方法の分まで (PayPay で入れた分は PayPay で)',
      ] },
      { icon: ICON.paypay(), title: 'PayPay', lines: [
        `入金: 送金リンクを貼るだけで即反映 (**${yen(MIN_DEPOSIT_JPY.paypay)}** 〜)`,
        `出金: 手数料無料。送金リンクを DM で受け取り (**${yen(MIN_WITHDRAW_JPY.paypay)}** 〜)`,
      ] },
      { icon: ICON.ltc(), title: 'LTC', lines: [
        `入金: 専用アドレスに送金、1 承認で自動反映 (**${yen(MIN_DEPOSIT_JPY.ltc)}** 〜)`,
        `出金: 指定アドレスへ送金、手数料 ${yen(LTC_NETWORK_FEE_JPY)} (**${yen(MIN_WITHDRAW_JPY.ltc)}** 〜)`,
        'レートは CoinGecko の現在値で円に換算',
      ] },
    ],
  });
}

/** 全ゲームの概要を 1 枚に */
function allOverview(): EmbedBuilder {
  const games: Game[] = ['blackjack', 'slots', 'roulette', 'baccarat', 'videopoker', 'craps', 'mines'];
  return panelEmbed({
    icon: ICON.crown(), title: L('C4SINO'), tagline: '全ゲームの概要', footer: 'C4sino · 全ゲームの概要',
    sections: [
      ...games.map(g => {
        const x = info(g);
        return { icon: GAME_ICON[g](), title: NAME[g], lines: [x.tagline, `${betRange(g)} / ${x.rtp[0].replace(/^主な/, '')}`] };
      }),
      { icon: ICON.wallet(), title: '最低入金額', lines: depositLines() },
    ],
  });
}
