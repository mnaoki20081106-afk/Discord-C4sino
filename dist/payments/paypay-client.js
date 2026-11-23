// 旧サイドカー HTTP クライアントの代替。in-process で動く新しい PayPay クラスを薄く包む。
// 既存の呼び出し元 (index.ts / wallets.ts) のシグネチャは保つ。
import { PayPay, extractLinkId as _extractLinkId } from './paypay/index.js';
import { randomUUID } from 'node:crypto';
// ============================================================
// Login flow (OTL): paython-wrapper の PayPay は __init__ で phone/password を渡すと
// すぐに PAR → sign-in → OTL まで走る。loginStart 時点で PayPay インスタンスを作って
// map に残し、loginFinish で login(url) を呼んでトークン取得する。
// ============================================================
const _pending = new Map();
export async function loginStart(phone, password) {
    const pp = new PayPay(); // phone/password は後で doPasswordLogin で渡す
    await pp.doPasswordLogin(phone, password, false);
    const session = randomUUID();
    _pending.set(session, { pp });
    // 30 分で掃除
    setTimeout(() => _pending.delete(session), 30 * 60_000);
    return { session, needs_url: true };
}
export async function loginFinish(session, url) {
    const entry = _pending.get(session);
    if (!entry)
        throw new Error('session not found');
    const { pp } = entry;
    _pending.delete(session);
    await pp.login(url);
    let name = null;
    let ext = null;
    try {
        const prof = await pp.getProfile();
        name = prof.name;
        ext = prof.external_user_id;
    }
    catch { /* ignore profile failure */ }
    return {
        access_token: pp.access_token,
        refresh_token: pp.refresh_token,
        device_uuid: pp.device_uuid,
        external_user_id: ext,
        name,
    };
}
// ============================================================
// 通常 API 呼び出しは一時 PayPay インスタンスを作って叩くだけ
// ============================================================
export async function tokenRefresh(access_token, refresh_token) {
    const pp = new PayPay({ access_token, refresh_token });
    const r = await pp.tokenRefresh(refresh_token);
    return { access_token: r.payload.accessToken, refresh_token: r.payload.refreshToken };
}
export async function walletBalance(access_token) {
    const pp = new PayPay({ access_token });
    const b = await pp.getBalance();
    return {
        money: b.money,
        money_light: b.money_light,
        all_balance: b.all_balance,
        usable_balance: b.usable_balance,
        points: b.points,
    };
}
export async function walletProfile(access_token) {
    const pp = new PayPay({ access_token });
    const p = await pp.getProfile();
    return { name: p.name, external_user_id: p.external_user_id, icon: p.icon };
}
export async function linkCheck(code, access_token) {
    const pp = new PayPay({ access_token });
    const info = await pp.linkCheck(code, !access_token);
    return {
        amount: info.amount,
        status: info.status,
        sender_name: info.sender_name,
        sender_external_user_id: info.sender_external_user_id,
        has_password: info.has_password,
        order_id: info.order_id,
        chat_room_id: info.chat_room_id,
    };
}
export async function linkReceive(access_token, code, passcode) {
    const pp = new PayPay({ access_token });
    // 既存の linkCheck/linkReceive の 2 段構えを 1 回の呼び出しに。
    const info = await pp.linkCheck(code, false);
    if (info.status !== 'PENDING') {
        throw new Error(`link not pending (status=${info.status})`);
    }
    if (info.has_password && !passcode)
        throw new Error('passcode required');
    await pp.linkReceive(code, passcode);
    return { ok: true, amount: info.amount, order_id: info.order_id };
}
export async function createLink(access_token, amount, passcode) {
    const pp = new PayPay({ access_token });
    return pp.createLink(amount, passcode);
}
/** PayPay 送金リンク URL / ID 抽出。既存呼び出し元の "null 判定" に合わせるため非認識は null を返す。 */
export function extractLinkId(input) {
    const s = input.trim();
    const m = s.match(/pay\.paypay\.ne\.jp\/([A-Za-z0-9]+)/);
    if (m)
        return m[1];
    const m2 = s.match(/portal\/oauth2\/l\?id=([A-Za-z0-9]+)/);
    if (m2)
        return m2[1];
    if (/^[A-Za-z0-9]{10,30}$/.test(s))
        return s;
    return null;
}
void _extractLinkId;
