// 入金・ベットの下限 (JPY / chips)。/overview パネルで表示 & 入金時にも検査する。
export const MIN_DEPOSIT_JPY = {
    paypay: 1, // 手数料無料
    ltc: 1000, // ネットワーク手数料がかかるため下限を設定
};
export const MIN_WITHDRAW_JPY = {
    paypay: 1, // 手数料無料
    ltc: 1000, // ネットワーク手数料ぶん吸収する下限
};
/** LTC 出金時に利用者から控除するネットワーク手数料 (保守的な見積り、JPY)。 */
export const LTC_NETWORK_FEE_JPY = 30;
export const MIN_BET_CHIPS = {
    blackjack: 10,
    slots: 10,
};
export const MAX_BET_CHIPS = {
    blackjack: 50_000,
    slots: 10_000,
};
