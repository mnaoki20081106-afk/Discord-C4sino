// aws/verify.py の 1:1 TypeScript ポート。
// SHA256-PoW / scrypt-PoW の nonce 探索と、CHALLENGE_TYPES のルックアップ表。

import { createHash, scryptSync } from 'node:crypto';

/** 先頭から `difficulty` bit ぶんが 0 なら true。 */
function _check(digest: Buffer, difficulty: number): boolean {
  const full = Math.floor(difficulty / 8);
  const rem = difficulty % 8;
  for (let i = 0; i < full; i++) if (digest[i] !== 0) return false;
  if (rem > 0 && (digest[full] >> (8 - rem)) !== 0) return false;
  return true;
}

/** SHA256 ベースの PoW。 */
export function hashPow(challengeInput: string, checksum: string, difficulty: number): string {
  const combined = Buffer.from(challengeInput + checksum, 'utf-8');
  for (let nonce = 0; ; nonce++) {
    const data = Buffer.concat([combined, Buffer.from(String(nonce))]);
    const digest = createHash('sha256').update(data).digest();
    if (_check(digest, difficulty)) return String(nonce);
  }
}

/** scrypt(N=memory, r=8, p=1, dklen=16) ベースの PoW。 */
export function computeScryptNonce(challengeInput: string, checksum: string, difficulty: number): string {
  const combined = challengeInput + checksum;
  const salt = checksum;
  const memory = 128;
  for (let nonce = 0; ; nonce++) {
    const key = scryptSync(`${combined}${nonce}`, salt, 16, { N: memory, r: 8, p: 1 });
    if (_check(Buffer.from(key), difficulty)) return String(nonce);
  }
}

/** 文字列マーカーの場合は "mp_verify" パスを使う (bandwidth challenge)。 */
export type ChallengeSolver = ((input: string, checksum: string, difficulty: number) => string) | string;

export const CHALLENGE_TYPES: Record<string, ChallengeSolver> = {
  'h72f957df656e80ba55f5d8ce2e8c7ccb59687dba3bfb273d54b08a261b2f3002': computeScryptNonce,
  'h7b0c470f0cfe3a80a9e26526ad185f484f6817d0832712a4a37a908786a6a67f': hashPow,
  'ha9faaffd31b4d5ede2a2e19d2d7fd525f66fee61911511960dcbb52d3c48ce25': 'mp_verify',
};
