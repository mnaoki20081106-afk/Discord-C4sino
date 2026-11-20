import { db } from '../db/schema.js';
import * as pp from './paypay-client.js';

export interface Wallet {
  id: number;
  kind: 'paypay' | 'ltc';
  label: string;
  enabled: 1 | 0;
  phone: string | null;
  access_token: string | null;
  refresh_token: string | null;
  device_uuid: string | null;
  external_user_id: string | null;
  display_name: string | null;
  address: string | null;
  derivation: string | null;
  owner_id: string;
  created_at: number;
  last_used_at: number | null;
  balance_cached: number | null;
}

export function listWallets(kind?: 'paypay'|'ltc'): Wallet[] {
  const where = kind ? 'WHERE kind=?' : '';
  const stmt = db.prepare(`SELECT * FROM wallets ${where} ORDER BY id`);
  return (kind ? stmt.all(kind) : stmt.all()) as Wallet[];
}

export function getWallet(id: number): Wallet | undefined {
  return db.prepare('SELECT * FROM wallets WHERE id=?').get(id) as Wallet | undefined;
}

export function addLtcWallet(ownerId: string, label: string, address: string, derivation?: string): number {
  const s = db.prepare(`INSERT INTO wallets(kind,label,enabled,address,derivation,owner_id)
    VALUES ('ltc',?,1,?,?,?)`);
  return s.run(label, address, derivation ?? null, ownerId).lastInsertRowid as number;
}

export interface LtcHotKey { priv: string; pub: string; address?: string; }
/** 秘密鍵をもつ (= 自動送金可能な) LTC ホットウォレット一覧 */
export function listLtcHotWallets(): Array<Wallet & { key: LtcHotKey }> {
  const rows = db.prepare(`SELECT * FROM wallets WHERE kind='ltc' AND enabled=1 AND derivation IS NOT NULL`).all() as Wallet[];
  const out: Array<Wallet & { key: LtcHotKey }> = [];
  for (const w of rows) {
    try {
      const d = JSON.parse(w.derivation!);
      if (d && d.priv && d.pub) out.push({ ...w, key: d });
    } catch { /* skip malformed */ }
  }
  return out;
}

export function addPaypayWallet(ownerId: string, label: string, phone: string, tokens: pp.LoginFinishResp): number {
  const s = db.prepare(`INSERT INTO wallets(kind,label,enabled,phone,access_token,refresh_token,device_uuid,external_user_id,display_name,owner_id)
    VALUES ('paypay',?,1,?,?,?,?,?,?,?)`);
  return s.run(label, phone, tokens.access_token, tokens.refresh_token, tokens.device_uuid, tokens.external_user_id, tokens.name, ownerId).lastInsertRowid as number;
}

export function setEnabled(id: number, enabled: boolean): boolean {
  return db.prepare('UPDATE wallets SET enabled=? WHERE id=?').run(enabled?1:0, id).changes > 0;
}

export function removeWallet(id: number): boolean {
  return db.prepare('DELETE FROM wallets WHERE id=?').run(id).changes > 0;
}

export function touchUsed(id: number, balance?: number) {
  db.prepare('UPDATE wallets SET last_used_at=strftime("%s","now"), balance_cached=COALESCE(?, balance_cached) WHERE id=?')
    .run(balance ?? null, id);
}

export function updateTokens(id: number, access: string, refresh: string) {
  db.prepare('UPDATE wallets SET access_token=?, refresh_token=? WHERE id=?').run(access, refresh, id);
}

/**
 * 有効な PayPay ウォレットを 1 件選ぶ (ラウンドロビン風: 最後に使われてないものから優先)。
 */
export function pickPaypayWallet(): Wallet | null {
  const w = db.prepare(`SELECT * FROM wallets WHERE kind='paypay' AND enabled=1
    ORDER BY COALESCE(last_used_at, 0) ASC, id ASC LIMIT 1`).get() as Wallet | undefined;
  return w ?? null;
}

/**
 * アクセストークンで PayPay 操作を行い、401 だったら refresh して 1 度だけリトライ。
 */
export async function withPaypay<T>(wallet: Wallet, fn: (accessToken: string) => Promise<T>): Promise<T> {
  if (!wallet.access_token) throw new Error('wallet has no access_token');
  try {
    return await fn(wallet.access_token);
  } catch (e: any) {
    const msg = String(e?.message ?? '');
    if (!/login_error|401/.test(msg) || !wallet.refresh_token) throw e;
    const r = await pp.tokenRefresh(wallet.refresh_token);
    updateTokens(wallet.id, r.access_token, r.refresh_token);
    return await fn(r.access_token);
  }
}
