// LTC 入金監視 - BlockCypher の軽量ポーリング実装。
// 本番は独自ノードや webhook を推奨。ここでは最小構成。

import { db } from '../db/schema.js';

const API = 'https://api.blockcypher.com/v1/ltc/main';

export async function getOrCreateAddress(discordId: string): Promise<string> {
  const existing = db.prepare('SELECT address FROM ltc_addresses WHERE discord_id = ?').get(discordId) as { address: string } | undefined;
  if (existing) return existing.address;

  // ホットウォレット運用。鍵は外部KMS推奨。ここではデモとして BlockCypher の address 生成を利用。
  const token = process.env.LTC_API_TOKEN;
  if (!token) throw new Error('LTC_API_TOKEN not set');
  const res = await fetch(`${API}/addrs?token=${token}`, { method: 'POST' });
  if (!res.ok) throw new Error(`BlockCypher addrs: ${res.status}`);
  const j = await res.json() as { address: string; private: string; public: string };
  db.prepare('INSERT INTO ltc_addresses(discord_id, address, derivation) VALUES (?,?,?)')
    .run(discordId, j.address, JSON.stringify({ priv: j.private, pub: j.public }));
  return j.address;
}

export interface ConfirmedTx { txid: string; value_ltc: number; }

export async function checkDeposits(address: string): Promise<ConfirmedTx[]> {
  const token = process.env.LTC_API_TOKEN;
  const url = `${API}/addrs/${address}/full${token?`?token=${token}`:''}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const j = await res.json() as { txs?: Array<{ hash: string; confirmations: number; outputs: Array<{ addresses: string[]; value: number }> }> };
  const confirmed: ConfirmedTx[] = [];
  for (const tx of j.txs ?? []) {
    if (tx.confirmations < 1) continue;
    const out = tx.outputs.find(o => o.addresses?.includes(address));
    if (!out) continue;
    confirmed.push({ txid: tx.hash, value_ltc: out.value / 1e8 });
  }
  return confirmed;
}

// LTC/JPY レート (CoinGecko, 無認証)
export async function ltcJpyRate(): Promise<number> {
  const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=jpy');
  if (!r.ok) throw new Error('rate fetch failed');
  const j = await r.json() as { litecoin: { jpy: number } };
  return j.litecoin.jpy;
}
