// 入金・ベットの下限 (JPY / chips)。/overview パネルで表示 & 入金時にも検査する。

export const MIN_DEPOSIT_JPY = {
  paypay: 100,
  ltc:    500,
} as const;

export const MIN_BET_CHIPS = {
  blackjack: 10,
  slots:     10,
} as const;

export const MAX_BET_CHIPS = {
  blackjack: 50_000,
  slots:     10_000,
} as const;
