import { db } from '../db/schema.js';
import * as pp from './paypay-client.js';
import { encryptSecret, decryptSecret, isEncrypted } from './crypto.js';
// 内部ヘルパ: SQL から出てきた row の秘密フィールドを復号して返す
function decryptWalletRow(w) {
    return {
        ...w,
        access_token: w.access_token ? decryptSecret(w.access_token) : null,
        refresh_token: w.refresh_token ? decryptSecret(w.refresh_token) : null,
        derivation: w.derivation ? decryptSecret(w.derivation) : null,
    };
}
export function listWallets(kind) {
    const where = kind ? 'WHERE kind=?' : '';
    const stmt = db.prepare(`SELECT * FROM wallets ${where} ORDER BY id`);
    const rows = (kind ? stmt.all(kind) : stmt.all());
    return rows.map(decryptWalletRow);
}
export function getWallet(id) {
    const r = db.prepare('SELECT * FROM wallets WHERE id=?').get(id);
    return r ? decryptWalletRow(r) : undefined;
}
export function addLtcWallet(ownerId, label, address, derivation) {
    const s = db.prepare(`INSERT INTO wallets(kind,label,enabled,address,derivation,owner_id)
    VALUES ('ltc',?,1,?,?,?)`);
    return s.run(label, address, derivation ? encryptSecret(derivation) : null, ownerId).lastInsertRowid;
}
/** 秘密鍵をもつ (= 自動送金可能な) LTC ホットウォレット一覧 */
export function listLtcHotWallets() {
    const rows = db.prepare(`SELECT * FROM wallets WHERE kind='ltc' AND enabled=1 AND derivation IS NOT NULL`).all();
    const out = [];
    for (const raw of rows) {
        try {
            const w = decryptWalletRow(raw);
            const d = JSON.parse(w.derivation);
            if (d && d.priv && d.pub)
                out.push({ ...w, key: d });
        }
        catch { /* skip malformed */ }
    }
    return out;
}
export function addPaypayWallet(ownerId, label, phone, tokens) {
    const s = db.prepare(`INSERT INTO wallets(kind,label,enabled,phone,access_token,refresh_token,device_uuid,external_user_id,display_name,owner_id)
    VALUES ('paypay',?,1,?,?,?,?,?,?,?)`);
    return s.run(label, phone, encryptSecret(tokens.access_token), encryptSecret(tokens.refresh_token), tokens.device_uuid, tokens.external_user_id, tokens.name, ownerId).lastInsertRowid;
}
export function setEnabled(id, enabled) {
    return db.prepare('UPDATE wallets SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id).changes > 0;
}
export function removeWallet(id) {
    return db.prepare('DELETE FROM wallets WHERE id=?').run(id).changes > 0;
}
export function touchUsed(id, balance) {
    db.prepare('UPDATE wallets SET last_used_at=strftime("%s","now"), balance_cached=COALESCE(?, balance_cached) WHERE id=?')
        .run(balance ?? null, id);
}
/**
 * 残高キャッシュを delta ぶん即時調整する。外部システム (PayPay API / BlockCypher) の
 * 反映を待たずにローカル帳簿で正確な残高を保つ。入金/出金/運営引き出しのすべてで呼ぶこと。
 */
export function adjustCached(id, deltaJpy) {
    const row = db.prepare('UPDATE wallets SET balance_cached = MAX(0, COALESCE(balance_cached,0) + ?), last_used_at = strftime("%s","now") WHERE id=? RETURNING balance_cached')
        .get(deltaJpy, id);
    return row?.balance_cached ?? 0;
}
/**
 * 外部 API から取得した真の残高で cache を上書き。定期 refresh 時に使う。
 */
export function setCached(id, balance) {
    db.prepare('UPDATE wallets SET balance_cached=?, last_used_at=strftime("%s","now") WHERE id=?').run(balance, id);
}
export function updateTokens(id, access, refresh) {
    db.prepare('UPDATE wallets SET access_token=?, refresh_token=? WHERE id=?')
        .run(encryptSecret(access), encryptSecret(refresh), id);
}
/** 起動時: 平文のまま残っている既存の token / derivation を暗号化する (migration)。 */
export function migrateEncryptPlaintextSecrets() {
    const rows = db.prepare('SELECT id, access_token, refresh_token, derivation FROM wallets').all();
    let migrated = 0;
    for (const r of rows) {
        const updates = [];
        const vals = [];
        if (r.access_token && !isEncrypted(r.access_token)) {
            updates.push('access_token=?');
            vals.push(encryptSecret(r.access_token));
        }
        if (r.refresh_token && !isEncrypted(r.refresh_token)) {
            updates.push('refresh_token=?');
            vals.push(encryptSecret(r.refresh_token));
        }
        if (r.derivation && !isEncrypted(r.derivation)) {
            updates.push('derivation=?');
            vals.push(encryptSecret(r.derivation));
        }
        if (updates.length) {
            db.prepare(`UPDATE wallets SET ${updates.join(', ')} WHERE id=?`).run(...vals, r.id);
            migrated++;
        }
    }
    if (migrated)
        console.log(`[crypto] migrated ${migrated} wallet row(s) to encrypted-at-rest`);
}
/** ltc_addresses.derivation も同じく暗号化へ移行 */
export function migrateEncryptLtcAddressDerivations() {
    const rows = db.prepare('SELECT discord_id, derivation FROM ltc_addresses').all();
    let migrated = 0;
    for (const r of rows) {
        if (r.derivation && !isEncrypted(r.derivation)) {
            db.prepare('UPDATE ltc_addresses SET derivation=? WHERE discord_id=?').run(encryptSecret(r.derivation), r.discord_id);
            migrated++;
        }
    }
    if (migrated)
        console.log(`[crypto] migrated ${migrated} ltc_address row(s) to encrypted-at-rest`);
}
/**
 * 有効な PayPay ウォレットを 1 件選ぶ (ラウンドロビン風: 最後に使われてないものから優先)。
 */
export function pickPaypayWallet() {
    const w = db.prepare(`SELECT * FROM wallets WHERE kind='paypay' AND enabled=1
    ORDER BY COALESCE(last_used_at, 0) ASC, id ASC LIMIT 1`).get();
    return w ?? null;
}
/**
 * アクセストークンで PayPay 操作を行い、401 だったら refresh して 1 度だけリトライ。
 */
export async function withPaypay(wallet, fn) {
    if (!wallet.access_token)
        throw new Error('wallet has no access_token');
    try {
        return await fn(wallet.access_token);
    }
    catch (e) {
        const msg = String(e?.message ?? '');
        if (!/login_error|401/.test(msg) || !wallet.refresh_token || !wallet.access_token)
            throw e;
        // paython-wrapper の token_refresh は古い access_token も必要とする
        const r = await pp.tokenRefresh(wallet.access_token, wallet.refresh_token);
        updateTokens(wallet.id, r.access_token, r.refresh_token);
        return await fn(r.access_token);
    }
}
