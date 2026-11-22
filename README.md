# Discord C4sino

Discord 上で動くカジノ bot。各チャンネルに常設パネルを設置し、
ユーザーはパネルから **Blackjack** / **Slots** をプレイできる。
入金は **PayPay 送金リンク (自動受領)** または **LTC (自動検出)**。
ゲーム画面は canvas で都度レンダリングし、テーブル / 筐体のリアルな見た目を提供する。

## 構成
```
src/
  index.ts                 # Bot本体 / ルーティング / 管理コマンド / サイドカー連携
  register-commands.ts
  db/schema.ts             # SQLite (users, ledger, deposits, sessions, wallets, user_bans)
  games/{blackjack,slots,session-store}.ts
  payments/
    paypay-client.ts       # Pythonサイドカーを叩くHTTPクライアント
    wallets.ts             # 運営ウォレット (PayPay/LTC) 選択・トークン更新
    ltc.ts                 # BlockCypher 監視 (ユーザー入金用アドレス)
  ui/{render-table,render-slots,panels,leet}.ts
services/paypay/
  server.py                # paython-wrapper を使う Flask サイドカー
  requirements.txt
```

## セットアップ
1. `.env.example` → `.env` を作成し各値を設定
2. `npm i`
3. **PayPay サイドカー起動**
   ```bash
   cd services/paypay
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   # Selenium (新規ログイン時のみ)
   export SIDECAR_SECRET=$(openssl rand -hex 24)
   python server.py
   ```
   `.env` に同じ `PAYPAY_SIDECAR_SECRET` を入れる。
4. `npm run register`
5. `npm run build && npm start`
6. Discord 側で:
   - `/setup game:blackjack` / `/setup game:slots` / `/setup game:cashier`
   - `/admin panel`（運営用）
   - `/wallet add-paypay label:main` → Modal で phone/password → SMS URL を入力
   - `/wallet add-ltc label:cold address:...`

## PayPay
- バックエンドは [paython-wrapper](https://github.com/wieweiwie8878-wq/paython-wrapper) 由来のモバイルAPI (`app4.paypay.ne.jp/bff`, `/p2p`)
- 新規ログインは Selenium 必須（AWS WAF 回避のため）
- 複数ウォレットを登録可、受領は未使用順のラウンドロビン
- 90日毎にアクセストークン自動更新（`withPaypay` が 401 で refresh → 再試行）
- 5 分毎に `get_balance()` を呼んで運営ウォレット残高をローカル帳簿と再同期

### ユーザー入金フロー
1. ユーザーが Cashier パネルの「PayPay 送金リンク入金」を押す
2. Modal に送金 URL / ID と（必要なら）passcode
3. Bot が `/link/check` で状態確認後、`/link/receive` で受領
4. 金額をチップとして残高加算、`deposits` に `confirmed` で記録

### 管理者用ウォレット登録フロー
1. `/wallet add-paypay label:xxx` → phone/password
2. Bot が sidecar `/login/start` → PayPay から SMS が届く
3. 「SMS URL を入力」ボタン → Modal に URL
4. Bot が `/login/finish` → access/refresh/device_uuid を DB 保存

## 管理コマンド
- `/admin balance user:<@u> delta:<n> reason:<s>` — チップ増減
- `/admin ban user:<@u> [reason]` / `/admin unban user:<@u>`
- `/admin stats` — 流通チップ / 累計BET/WIN / ハウスエッジ / 入金合計
- `/admin tx user:<@u> [limit]` — 取引履歴
- `/admin panel` — 管理用ショートカット付きパネルを常設

## ゲーム仕様
### Blackjack
- 6デッキシュー、`crypto.randomInt` の Fisher–Yates
- Dealer: soft 17 hit (H17) / BJ 3:2 / Double / Split (最大4ハンド)
- 画面はユーザー ephemeral

### Slots
- 3リール8シンボル、重み付き (RTP ~94–96%)
- 3-of-a-kind と 2連チェリーのサイド配当
- 3フレーム停止アニメ (リールごとに停止時間差)

## 注意
- 法令・Discord ToS に従って運用してください。
- PayPay / LTC トークンは平文で SQLite に保存されます。本番は暗号化 (OS keyring, KMS など) を検討。
- paython-wrapper は非公式。利用は自己責任、PayPay 側の仕様変更で壊れる可能性あり。
