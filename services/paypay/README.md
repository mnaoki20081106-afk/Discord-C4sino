# PayPay Sidecar

paython-wrapper (https://github.com/wieweiwie8878-wq/paython-wrapper) を使い、
PayPay モバイル API を Node (Discord bot) から呼べる localhost HTTP として提供する。

## セットアップ
```bash
cd services/paypay
python3.10+ -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### Selenium (新規ログイン時のみ必要)
`paython-wrapper[waf]` 依存で Selenium が入る。chromedriver は同環境に導入すること。
既にアクセストークンがあれば Selenium は不要。

## 起動
```bash
export SIDECAR_SECRET=$(openssl rand -hex 24)
export SIDECAR_PORT=8787
python server.py
```

Node 側 `.env`:
```
PAYPAY_SIDECAR_URL=http://127.0.0.1:8787
PAYPAY_SIDECAR_SECRET=<same>
```

## エンドポイント
| Method | Path | 概要 |
|---|---|---|
| POST | /login/start | 電話番号+パスワードで SMS 送信を発火、session を返す |
| POST | /login/finish | SMS 内の URL を渡して access/refresh/device_uuid を取得 |
| POST | /token/refresh | 失効トークンを更新 |
| POST | /wallet/balance | 残高 (money/money_light/points/usable) |
| POST | /wallet/profile | name/external_user_id/icon |
| POST | /link/check | 送金リンクの状態確認 (access_token なしなら web_api) |
| POST | /link/receive | 送金リンクを受領 (passcode あれば渡す) |
| POST | /alive | Bot 検知回避の keepalive |
| GET  | /health | ヘルスチェック |

実際のバックエンドは paython-wrapper が叩く `app4.paypay.ne.jp/bff` と `app4.paypay.ne.jp/p2p` を使用。
