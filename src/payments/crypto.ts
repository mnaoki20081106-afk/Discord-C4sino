import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';

function masterKey(): Buffer {
  const raw = process.env.MASTER_ENC_KEY;
  if (!raw) {
    throw new Error('MASTER_ENC_KEY env var is required (32-byte hex or any passphrase). Refusing to read/write secrets without it.');
  }
  // 32 bytes hex ならそのまま、それ以外は scrypt でキー派生
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  return scryptSync(raw, 'c4sino-enc-v1', 32);
}

let _key: Buffer | null = null;
function getKey(): Buffer {
  if (!_key) _key = masterKey();
  return _key;
}

/** 平文文字列を暗号化して "enc:v1:<base64>" にして返す。null/空は null を返す。 */
export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain == null || plain === '') return null;
  if (typeof plain === 'string' && plain.startsWith(PREFIX)) return plain; // 二重暗号化防止
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, tag, ct]).toString('base64');
  return PREFIX + packed;
}

/** "enc:v1:..." を復号。従来の平文 (prefix なし) はそのまま返す (migration 期間用)。 */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (stored == null || stored === '') return null;
  if (!stored.startsWith(PREFIX)) return stored;   // 平文 (未移行) の場合はそのまま
  const packed = Buffer.from(stored.slice(PREFIX.length), 'base64');
  if (packed.length < 28) throw new Error('encrypted blob too short');
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ct = packed.subarray(28);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** 現在の値が暗号化されているか */
export function isEncrypted(stored: string | null | undefined): boolean {
  return typeof stored === 'string' && stored.startsWith(PREFIX);
}
