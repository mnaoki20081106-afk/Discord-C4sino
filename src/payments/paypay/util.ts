// paython-wrapper/client.py の内部ユーティリティ _parse_request_id / _strip_phone_hyphen / _extract_link_id

export function parseRequestId(raw: string): string {
  for (const pair of raw.split('&')) {
    const [k, ...rest] = pair.split('=');
    if (k === 'code') return rest.join('=');
  }
  return '';
}

export function stripPhoneHyphen(phone: string): string {
  return phone?.includes('-') ? phone.replace(/-/g, '') : phone;
}

export function extractLinkId(urlOrId: string): string {
  for (const prefix of [
    'https://pay.paypay.ne.jp/',
    'https://www.paypay.ne.jp/portal/oauth2/l?id=',
  ]) {
    if (urlOrId.startsWith(prefix)) return urlOrId.substring(prefix.length);
  }
  return urlOrId;
}

export type ProxySpec = string | { host?: string; port?: number; protocol?: string; auth?: { username: string; password: string } } | null | undefined;
