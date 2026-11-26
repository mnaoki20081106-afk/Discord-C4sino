// 入金・ベットの下限 (JPY / chips)。/overview パネルで表示 & 入金時にも検査する。

export const MIN_DEPOSIT_JPY = {
  paypay: 1,        // 手数料無料
  ltc:    1000,     // ネットワーク手数料がかかるため下限を設定
} as const;

export const MIN_WITHDRAW_JPY = {
  paypay: 1,        // 手数料無料
  ltc:    1000,     // ネットワーク手数料ぶん吸収する下限
} as const;

/** LTC 出金時に利用者から控除するネットワーク手数料 (保守的な見積り、JPY)。 */
export const LTC_NETWORK_FEE_JPY = 30;

/** 1 回の BET (クラップスは 1 つの賭け) の下限・上限。パネルの表示とテーブルの判定の両方がこれを使う。 */
export const MIN_BET_CHIPS = {
  blackjack:  10,
  slots:      10,
  roulette:   10,
  baccarat:   10,
  videopoker: 10,
  craps:      10,
  mines:      10,
} as const;

export const MAX_BET_CHIPS = {
  blackjack:  50_000,
  slots:      50_000,
  roulette:   50_000,
  baccarat:   50_000,
  videopoker: 50_000,
  craps:      50_000,
  mines:      50_000,
} as const;
