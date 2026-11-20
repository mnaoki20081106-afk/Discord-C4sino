// PayPay サイドカー (services/paypay/server.py) を叩く薄い HTTP クライアント。

const BASE   = process.env.PAYPAY_SIDECAR_URL ?? 'http://127.0.0.1:8787';
const SECRET = process.env.PAYPAY_SIDECAR_SECRET ?? '';

async function call<T>(path: string, body: Record<string, unknown>, method: 'POST'|'GET' = 'POST'): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(SECRET ? { 'x-sidecar-secret': SECRET } : {}),
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let j: any = null;
  try { j = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  if (!res.ok) throw new Error(j?.error ?? `sidecar ${res.status}: ${text.slice(0,200)}`);
  return j as T;
}

export interface LoginStartResp { session: string; needs_url: true; }
export const loginStart = (phone: string, password: string) =>
  call<LoginStartResp>('/login/start', { phone, password });

export interface LoginFinishResp {
  access_token: string;
  refresh_token: string;
  device_uuid: string;
  external_user_id: string | null;
  name: string | null;
}
export const loginFinish = (session: string, url: string) =>
  call<LoginFinishResp>('/login/finish', { session, url });

export const tokenRefresh = (refresh_token: string) =>
  call<{ access_token: string; refresh_token: string }>('/token/refresh', { refresh_token });

export interface WalletBalance {
  money: number | null; money_light: number;
  all_balance: number; usable_balance: number; points: number;
}
export const walletBalance = (access_token: string) =>
  call<WalletBalance>('/wallet/balance', { access_token });

export interface WalletProfile { name: string; external_user_id: string; icon: string; }
export const walletProfile = (access_token: string) =>
  call<WalletProfile>('/wallet/profile', { access_token });

export interface LinkInfo {
  amount: number; status: string; sender_name: string;
  sender_external_user_id: string; has_password: boolean;
  order_id: string; chat_room_id: string;
}
export const linkCheck = (code: string, access_token?: string) =>
  call<LinkInfo>('/link/check', { code, access_token });

export const linkReceive = (access_token: string, code: string, passcode?: string) =>
  call<{ ok: true; amount: number; order_id: string }>('/link/receive', { access_token, code, passcode });

export const alive = (access_token: string) =>
  call<{ ok: true }>('/alive', { access_token });

/** PayPay 送金リンク URL / ID 抽出 */
export function extractLinkId(input: string): string | null {
  const s = input.trim();
  const m = s.match(/pay\.paypay\.ne\.jp\/([A-Za-z0-9]+)/);
  if (m) return m[1];
  const m2 = s.match(/portal\/oauth2\/l\?id=([A-Za-z0-9]+)/);
  if (m2) return m2[1];
  if (/^[A-Za-z0-9]{10,30}$/.test(s)) return s;
  return null;
}
