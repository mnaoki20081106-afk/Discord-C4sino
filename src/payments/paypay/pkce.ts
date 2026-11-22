// PKCE S256 の最小実装。paython-wrapper は pkce.generate_pkce_pair(43) を使用。
// 43 文字 = base64url(32-byte random) でちょうど 43 文字になる。

import { randomBytes, createHash } from 'node:crypto';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 32 バイトの乱数から base64url 43 文字の code_verifier を作る。 */
export function generateCodeVerifier(length = 43): string {
  // 43 文字 → 32 バイト (base64url ≈ len * 3/4)。他の長さは length * 3/4 近似
  const rawLen = Math.ceil((length * 3) / 4);
  return b64url(randomBytes(rawLen)).slice(0, length);
}

/** code_verifier の S256 ハッシュを取って code_challenge を返す。 */
export function generateCodeChallenge(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest());
}

/** paython-wrapper の pkce.generate_pkce_pair(43) 相当。 */
export function generatePkcePair(length = 43): { verifier: string; challenge: string } {
  const verifier = generateCodeVerifier(length);
  return { verifier, challenge: generateCodeChallenge(verifier) };
}
