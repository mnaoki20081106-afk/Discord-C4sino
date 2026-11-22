// LTC 入金監視 + 送金 (自動出金) - BlockCypher API 経由。
// 本番は独自ノードや webhook を推奨。

import { db } from '../db/schema.js';
import * as secp from '@noble/secp256k1';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';

// @noble/secp256k1 v2 (同期 API) は HMAC-SHA256 をユーザーが登録する必要がある
(secp as any).etc.hmacSha256Sync = (k: Uint8Array, ...m: Uint8Array[]) =>
  hmac(sha256, k, (secp as any).etc.concatBytes(...m));

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

export async function addressBalanceLtc(address: string): Promise<number> {
  const token = process.env.LTC_API_TOKEN;
  const res = await fetch(`${API}/addrs/${address}/balance${token?`?token=${token}`:''}`);
  if (!res.ok) throw new Error(`balance ${res.status}`);
  const j = await res.json() as { final_balance: number };
  return j.final_balance / 1e8;
}

export async function checkDeposits(address: string): Promise<ConfirmedTx[]> {
  const token = process.env.LTC_API_TOKEN;
  const url = `${API}/addrs/${address}/full${token?`?token=${token}`:''}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const j = await res.json() as { txs?: Array<{ hash: string; confirmations: number; outputs: Array<{ addresses: string[]; value: number }> }> };
  const confirmed: ConfirmedTx[] = [];
  for (const tx of j.txs ?? []) {
    if (tx.confirmations < 3) continue;   // reorg 耐性: 3-conf (≈ 7.5 分)
    const out = tx.outputs.find(o => o.addresses?.includes(address));
    if (!out) continue;
    confirmed.push({ txid: tx.hash, value_ltc: out.value / 1e8 });
  }
  return confirmed;
}

// LTC/JPY レート (CoinGecko, 無認証)。sticky cache で CoinGecko 障害時も 1h は前回値を使う。
let _rateCache: { at: number; rate: number } | null = null;
const RATE_FRESH_MS = 5 * 60_000;      // 5 分以内: そのまま返す (API 叩かない)
const RATE_STICKY_MS = 60 * 60_000;    // 60 分以内: API 失敗時のフォールバックとして使う
export async function ltcJpyRate(): Promise<number> {
  const now = Date.now();
  if (_rateCache && now - _rateCache.at < RATE_FRESH_MS) return _rateCache.rate;
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=jpy',
      { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`coingecko ${r.status}`);
    const j = await r.json() as { litecoin: { jpy: number } };
    const rate = j.litecoin.jpy;
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('coingecko malformed rate');
    _rateCache = { at: now, rate };
    return rate;
  } catch (e) {
    if (_rateCache && now - _rateCache.at < RATE_STICKY_MS) {
      console.warn(`[ltcJpyRate] fresh fetch failed, using sticky cache (${((now - _rateCache.at)/1000)|0}s old):`, (e as Error).message);
      return _rateCache.rate;
    }
    throw e;
  }
}

/**
 * LTC 送金 (ホットウォレット) — BlockCypher の 2 段 API を使う:
 *   1) POST /txs/new  → tx skeleton + 署名すべき hash 配列 (tosign)
 *   2) ECDSA (secp256k1) でローカル署名
 *   3) POST /txs/send → ブロードキャスト → txid 返却
 * priv は hex 文字列 (64 chars)、公開鍵は圧縮形式 (33 bytes)
 */
export async function sendLtc(fromAddress: string, privHex: string, toAddress: string, amountLtc: number): Promise<{ txid: string; feeLtc: number }> {
  const token = process.env.LTC_API_TOKEN;
  if (!token) throw new Error('LTC_API_TOKEN not set');
  const q = `?token=${token}`;
  const satoshi = Math.floor(amountLtc * 1e8);
  if (satoshi <= 0) throw new Error('invalid amount');

  // 1) create new tx skeleton
  const newRes = await fetch(`${API}/txs/new${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inputs: [{ addresses: [fromAddress] }],
      outputs: [{ addresses: [toAddress], value: satoshi }],
    }),
  });
  if (!newRes.ok) {
    const t = await newRes.text();
    throw new Error(`ltc tx/new ${newRes.status}: ${t.slice(0, 200)}`);
  }
  const skel = await newRes.json() as { tx: any; tosign: string[]; errors?: any[]; fees?: number };
  if (skel.errors && skel.errors.length) throw new Error(`ltc tx/new: ${JSON.stringify(skel.errors)}`);

  // 2) local sign
  const priv = hexToBytes(privHex);
  const pub  = secp.getPublicKey(priv, true);           // 圧縮公開鍵
  const pubHex = bytesToHex(pub);
  const signatures: string[] = [];
  for (const hashHex of skel.tosign) {
    const sig = secp.sign(hexToBytes(hashHex), priv, { lowS: true });
    signatures.push(sigToDERHex(sig.r, sig.s));
  }
  const pubkeys = skel.tosign.map(() => pubHex);

  // 3) send
  const sendRes = await fetch(`${API}/txs/send${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...skel, signatures, pubkeys }),
  });
  if (!sendRes.ok) {
    const t = await sendRes.text();
    throw new Error(`ltc tx/send ${sendRes.status}: ${t.slice(0, 200)}`);
  }
  const sent = await sendRes.json() as { tx: { hash: string; fees?: number } };
  return { txid: sent.tx.hash, feeLtc: (sent.tx.fees ?? skel.fees ?? 0) / 1e8 };
}

/** bigint → 大端バイト列 (先頭バイトの最上位 bit が立っていたら 0x00 を prepend して符号つき整数化) */
function intToDerBytes(n: bigint): Uint8Array {
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let bytes = hexToBytes(hex);
  if (bytes[0] & 0x80) {
    const padded = new Uint8Array(bytes.length + 1);
    padded.set(bytes, 1);
    bytes = padded;
  }
  return bytes;
}
function sigToDERHex(r: bigint, s: bigint): string {
  const rb = intToDerBytes(r);
  const sb = intToDerBytes(s);
  const total = 2 + rb.length + 2 + sb.length;
  const out = new Uint8Array(2 + total);
  let o = 0;
  out[o++] = 0x30; out[o++] = total;
  out[o++] = 0x02; out[o++] = rb.length; out.set(rb, o); o += rb.length;
  out[o++] = 0x02; out[o++] = sb.length; out.set(sb, o); o += sb.length;
  return bytesToHex(out);
}

function hexToBytes(h: string): Uint8Array {
  if (h.length % 2) throw new Error('bad hex');
  const o = new Uint8Array(h.length / 2);
  for (let i = 0; i < o.length; i++) o[i] = parseInt(h.slice(i*2, i*2+2), 16);
  return o;
}
function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

/** BlockCypher で新規アドレス + 秘密鍵ペアを生成 (HOT ウォレット用). */
export async function generateLtcHotAddress(): Promise<{ address: string; priv: string; pub: string }> {
  const token = process.env.LTC_API_TOKEN;
  if (!token) throw new Error('LTC_API_TOKEN not set');
  const r = await fetch(`${API}/addrs?token=${token}`, { method: 'POST' });
  if (!r.ok) throw new Error(`addrs ${r.status}`);
  const j = await r.json() as { address: string; private: string; public: string };
  return { address: j.address, priv: j.private, pub: j.public };
}
