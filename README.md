# Discord C4sino

Discord 上で動くカジノ bot。各チャンネルに常設パネルを設置し、
ユーザーはパネルから **Blackjack** / **Slots** をプレイできる。
入金は **PayPay 送金リンク (管理者承認)** か **LTC (自動検出)**。
ゲーム画面は canvas で都度レンダリングし、テーブル / 筐体のリアルな見た目を提供する。

## 構成
```
src/
  index.ts            # Bot本体 / interaction ルーティング
  register-commands.ts
  db/schema.ts        # SQLite (users, ledger, deposits, sessions)
  games/
    blackjack.ts      # 6-deck shoe / H17 / 3:2 / split 最大4 / double
    slots.ts          # 3リール 8シンボル / 重み付き
    session-store.ts
  payments/
    paypay.ts         # 送金リンク + 管理者承認
    ltc.ts            # BlockCypher 監視 + CoinGecko レート
  ui/
    render-table.ts   # BJテーブル画像
    render-slots.ts   # スロット筐体画像
    panels.ts         # 常設パネルの Embed/Button
```

## セットアップ
1. `.env.example` → `.env` を作成し各値を設定
2. `npm i`
3. `npm run register` （スラッシュコマンド登録）
4. `npm run build && npm start` （本番）または `npm run dev`
5. Discord 側で:
   - `/admin-channel` を管理者向けチャンネルで実行
   - 各遊技場チャンネルで `/setup game:blackjack` / `/setup game:slots` / `/setup game:cashier`

## ゲーム仕様
### Blackjack
- 6デッキシュー、シャッフルは `crypto.randomInt` の Fisher–Yates
- Dealer: soft 17 hit (H17)
- Blackjack 配当 3:2 (`floor(bet*2.5)`)
- Double / Split (同ランクのみ、最大4ハンド)
- 画面はユーザー ephemeral (手札は本人のみ)

### Slots
- 3リール、8シンボル、各シンボルに重み(RTP制御)
- 3-of-a-kind と 2連チェリーのサイド配当
- 停止アニメ: 3フレーム (リールごとに停止時間差)

## 入金
### PayPay
公式API非公開のため、ユーザーが送金リンク URL と金額を
Modal で提出 → 管理者チャンネルに承認/却下ボタン付きで通知 →
承認で残高に加算。

### LTC
BlockCypher API でユーザー専用アドレスを発行、60秒ごとにポーリング。
レートは CoinGecko (`litecoin -> jpy`) で都度取得し JPY 換算して加算。
※ 本番運用では独自ノード/Webhook + 鍵管理 (KMS) を推奨。

## 注意
- 法令・Discord ToS に従って運用してください。実通貨ベットは地域により規制対象。
- `LTC_API_TOKEN` 未設定時は LTC 機能は無効。
- `better-sqlite3` はネイティブビルドが必要 (`node-gyp`, 建築用の C++ toolchain)。
