# Discord C4sino

Discord 上で動くカジノ bot。各チャンネルに常設パネルを設置し、ユーザーはパネルから **Blackjack / Slots / Roulette / Baccarat / Video Poker / Craps** をプレイできる。
入金は **PayPay 送金リンク (自動受領)** または **LTC (自動検出)**。ゲーム画面は canvas で都度レンダリングする。

## 構成
```
src/
  index.ts                 # Bot本体 / ルーティング / 管理コマンド
  register-commands.ts
  db/schema.ts             # SQLite (users, ledger, deposits, withdrawals, sessions, wallets, user_bans, ...)
  games/{blackjack,slots,roulette,baccarat,videopoker,craps,session-store}.ts
  payments/
    paypay/                # paython-wrapper を TS に移植した in-process クライアント
    paypay-client.ts       # 既存シグネチャの薄いラッパ (paypay/ を呼ぶ)
    wallets.ts             # 運営ウォレット (PayPay/LTC) 管理
    ltc.ts                 # BlockCypher 監視 (ユーザー入金用アドレス) + ローカル鍵生成
    withdraw.ts / liquidity.ts / limits.ts / crypto.ts / ltc-address.ts
  moderation/{filter,automod}.ts   # NG 語 Webhook 書き換え
  ui/{panels,render-*,leet,overview}.ts
```

## セットアップ
1. `.env.example` → `.env` を作成し各値を設定
2. `npm i`
3. `npm run register`
4. `npm run build && npm start`
5. Discord 側で:
   - `/blackjack` / `/slots` / `/roulette` / `/baccarat` / `/videopoker` / `/craps` (各ゲーム卓を設置)
   - `/setup game:cashier` (入出金パネル)
   - `/admin panel` (運営用パネル)
   - `/wallet add-paypay label:main` → Modal で phone/password → SMS URL を入力
   - `/wallet add-ltc label:hot` (秘密鍵をローカル生成した hot wallet)

### 必須 env
```
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=        # (任意) ギルド単独登録用
MASTER_ENC_KEY=          # 32バイト hex or 任意 passphrase (DB 内 secrets の暗号化鍵)
LTC_API_TOKEN=           # BlockCypher
```

## PayPay
- 旧 Python サイドカーは廃止。[paython-wrapper](https://github.com/wieweiwie8878-wq/paython-wrapper) v3.1.0 の `client.py` を忠実に TypeScript へポートし、`src/payments/paypay/` に収容。
- endpoints: `app4.paypay.ne.jp/bff`, `/p2p`, `www.paypay.ne.jp/portal`
- 新規ログインの AWS WAF 回避は未実装 (MWS 等メモリ制約ホスティングで Puppeteer を立てられないため)。**access_token / refresh_token はローカル開発機で取得してから DB にインポート** する運用。
- 複数ウォレット登録可、受領は未使用順のラウンドロビン
- 90 日毎にアクセストークン自動更新 (`withPaypay` が 401 で tokenRefresh → 再試行)
- 5 分毎に `get_balance` を叩いて運営ウォレット残高をローカル帳簿と再同期

### ユーザー入金フロー
1. ユーザーが Cashier パネルの「PayPay 送金リンク入金」を押す
2. Modal に送金 URL / ID と (必要なら) passcode
3. Bot が `linkCheck` で状態確認後、`linkReceive` で受領
4. 金額をチップとして残高加算、`deposits` に `confirmed` で記録

### 管理者用ウォレット登録フロー
1. `/wallet add-paypay label:xxx` → phone/password
2. Bot が `loginStart` (PAR → sign-in → OTL) → PayPay から SMS が届く
3. 「SMS URL を入力」ボタン → Modal に URL
4. Bot が `loginFinish` → access/refresh/device_uuid を暗号化して DB 保存

## 管理コマンド (抜粋)
- `/admin user user:@u` — 総合ビュー (残高ゲージ + 累計 BET/WIN + 取引履歴)
- `/admin history user:@u type:…` — 全取引の時系列
- `/admin pending [method] [limit]` — 保留中/直近の出金
- `/admin grant user rail amount` — 特定レールへの chip 付与
- `/admin send-paypay / send-ltc` — 運営から個別ユーザーへ直接送金
- `/admin balance / ban / unban / stats / tx / panel / achievements / automod-sync`
- `/paypay login / balance / transfer` — 運営 PayPay 直接操作 (利益引き出し)
- `/banned-words add / list / remove` — NG ワード管理
- `/leet` — LEET 変換パネル

## ゲーム仕様
### Blackjack
- 6 デッキシュー、`crypto.randomInt` の Fisher–Yates
- Dealer: soft 17 hit (H17) / BJ 3:2 / Double / Split (最大 4 ハンド)
- 画面はユーザー ephemeral

### Slots / Roulette / Baccarat / Video Poker / Craps
- 各ゲーム固有の RTP とルール (詳細は `/overview game:<name>`)
- 全ゲーム共通: `housePayoutCap` による運営破綻防止 + レール追跡 (PP / LTC) の按分支払い

## 注意
- 法令・Discord ToS に従って運用してください。
- PayPay token / LTC 秘密鍵は AES-256-GCM で DB に暗号化保存 (`MASTER_ENC_KEY` 必須)。
- paython-wrapper は非公式 API。PayPay 側の仕様変更で壊れる可能性あり。
