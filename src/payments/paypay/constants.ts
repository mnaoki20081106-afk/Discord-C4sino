// paython-wrapper/client.py の URL/APP バージョン定数と、
// _app_headers / _webview_headers / _api_headers の忠実なポート

import type { DeviceState } from './device.js';

export const CLIENT_ID = 'pay2-mobile-app-client';
export const REDIRECT_URI = 'paypay://oauth2/callback';
export const APP_VERSION = '5.11.1';

export const BFF = 'https://app4.paypay.ne.jp/bff';
export const PORTAL = 'https://www.paypay.ne.jp/portal';
export const P2P = 'https://app4.paypay.ne.jp/p2p';

export const WV_UA =
  'Mozilla/5.0 (Linux; Android 10; SCV38 Build/QP1A.190711.020; wv) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 ' +
  `Chrome/132.0.6834.163 Mobile Safari/537.36 jp.pay2.app.android/${APP_VERSION}`;

export function appHeaders(deviceUuid: string, clientUuid: string, dev: DeviceState): Record<string, string> {
  return {
    'Accept': '*/*',
    'Accept-Charset': 'UTF-8',
    'Accept-Encoding': 'gzip',
    'Client-Mode': 'NORMAL',
    'Client-OS-Release-Version': '10',
    'Client-OS-Type': 'ANDROID',
    'Client-OS-Version': '29.0.0',
    'Client-Type': 'PAYPAYAPP',
    'Client-UUID': clientUuid,
    'Client-Version': APP_VERSION,
    'Connection': 'Keep-Alive',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Device-Acceleration': dev.acceleration,
    'Device-Acceleration-2': dev.acceleration_2,
    'Device-Brand-Name': 'KDDI',
    'Device-Hardware-Name': 'qcom',
    'Device-In-Call': 'false',
    'Device-Lock-App-Setting': 'false',
    'Device-Lock-Type': 'NONE',
    'Device-Manufacturer-Name': 'samsung',
    'Device-Name': 'SCV38',
    'Device-Orientation': dev.orientation,
    'Device-Orientation-2': dev.orientation_2,
    'Device-Rotation': dev.rotation,
    'Device-Rotation-2': dev.rotation_2,
    'Device-UUID': deviceUuid,
    'Host': 'app4.paypay.ne.jp',
    'Is-Emulator': 'false',
    'Network-Status': 'WIFI',
    'System-Locale': 'ja',
    'Timezone': 'Asia/Tokyo',
    'User-Agent': `PaypayApp/${APP_VERSION} Android10`,
  };
}

export function webviewHeaders(referer?: string): Record<string, string> {
  const h: Record<string, string> = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'ja-JP,ja;q=0.9',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Host': 'www.paypay.ne.jp',
    'Pragma': 'no-cache',
    'sec-ch-ua': '"Not A(Brand";v="8", "Chromium";v="132", "Android WebView";v="132"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': WV_UA,
    'X-Requested-With': 'jp.ne.paypay.android.app',
  };
  if (referer) h['Referer'] = referer;
  return h;
}

export function apiHeaders(referer?: string): Record<string, string> {
  const h: Record<string, string> = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'ja-JP,ja;q=0.9',
    'Cache-Control': 'no-cache',
    'Client-Id': CLIENT_ID,
    'Client-OS-Type': 'ANDROID',
    'Client-OS-Version': '29.0.0',
    'Client-Type': 'PAYPAYAPP',
    'Client-Version': APP_VERSION,
    'Connection': 'keep-alive',
    'Content-Type': 'application/json',
    'Host': 'www.paypay.ne.jp',
    'Pragma': 'no-cache',
    // paython-wrapper の原文どおり ("...132")" に末尾閉じ括弧あり)
    'sec-ch-ua': '"Not A(Brand";v="8", "Chromium";v="132", "Android WebView";v="132")',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'User-Agent': WV_UA,
    'X-Requested-With': 'jp.ne.paypay.android.app',
    'Origin': 'https://www.paypay.ne.jp',
  };
  if (referer) h['Referer'] = referer;
  return h;
}
