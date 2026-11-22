import { sha256 } from '@noble/hashes/sha256';

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(s: string): Uint8Array | null {
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(s)) return null;
  let num = 0n;
  for (const c of s) {
    const idx = B58_ALPHABET.indexOf(c);
    if (idx < 0) return null;
    num = num * 58n + BigInt(idx);
  }
  // to bytes
  const out: number[] = [];
  while (num > 0n) { out.push(Number(num & 0xffn)); num >>= 8n; }
  for (const c of s) { if (c === '1') out.push(0); else break; }
  return new Uint8Array(out.reverse());
}

function isValidBech32(hrp: string, s: string): boolean {
  const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const BECH32M_CONST = 0x2bc830a3;
  const BECH32_CONST  = 1;
  const parts = s.toLowerCase().split('1');
  if (parts.length < 2) return false;
  const addrHrp = parts.slice(0, -1).join('1');
  const data = parts[parts.length - 1];
  if (addrHrp !== hrp) return false;
  if (data.length < 6 || data.length > 90) return false;
  const values: number[] = [];
  for (const c of data) {
    const v = BECH32_CHARSET.indexOf(c);
    if (v < 0) return false;
    values.push(v);
  }
  // polymod verification
  const polymod = (vs: number[]) => {
    let chk = 1;
    for (const v of vs) {
      const top = chk >>> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ v;
      const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
      for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
    }
    return chk;
  };
  const hrpExpand: number[] = [];
  for (let i = 0; i < hrp.length; i++) hrpExpand.push(hrp.charCodeAt(i) >> 5);
  hrpExpand.push(0);
  for (let i = 0; i < hrp.length; i++) hrpExpand.push(hrp.charCodeAt(i) & 31);
  const final = polymod([...hrpExpand, ...values]);
  const witVer = values[0];
  // ver 0 → bech32 const 1, ver >=1 → bech32m const 0x2bc830a3
  return witVer === 0 ? final === BECH32_CONST : final === BECH32M_CONST;
}

/**
 * LTC 専用アドレス検証。他通貨 (BTC, DOGE 等) のアドレスを弾く。
 * - L で始まる P2PKH (version 0x30)
 * - M で始まる P2SH  (version 0x32)
 * - ltc1 で始まる bech32 (segwit v0 / v1)
 *
 * BTC の '1', '3', 'bc1' や DOGE の 'D' は Base58 的に通ってしまうため、
 * version byte とチェックサムで必ず判定する。
 */
export function isValidLtcAddress(addr: string): boolean {
  if (!addr || typeof addr !== 'string') return false;
  const s = addr.trim();
  if (s.length < 25 || s.length > 100) return false;

  // bech32 (ltc1...)
  if (/^ltc1[0-9a-z]+$/i.test(s)) {
    return isValidBech32('ltc', s);
  }

  // Base58Check (L.../M...)
  if (!/^[LM][1-9A-HJ-NP-Za-km-z]{25,40}$/.test(s)) return false;
  const bytes = base58Decode(s);
  if (!bytes || bytes.length !== 25) return false;
  const version = bytes[0];
  if (version !== 0x30 && version !== 0x32) return false;  // LTC のみ (BTC 0x00/0x05 を弾く)
  const payload = bytes.slice(0, 21);
  const checksum = bytes.slice(21, 25);
  const calc = sha256(sha256(payload)).slice(0, 4);
  for (let i = 0; i < 4; i++) if (calc[i] !== checksum[i]) return false;
  return true;
}
