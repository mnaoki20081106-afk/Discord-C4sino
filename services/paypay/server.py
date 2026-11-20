"""
PayPay サイドカー — paython-wrapper (wieweiwie8878-wq/paython-wrapper) を使って
PayPay モバイル API を叩く。Node 側 Bot から localhost HTTP で呼ぶ。

エンドポイント:
  POST /login/start      {phone, password}                    -> {session, needs_url: true}
  POST /login/finish     {session, url}                       -> {access_token, refresh_token, device_uuid, external_user_id, name}
  POST /token/refresh    {refresh_token}                      -> {access_token, refresh_token}
  POST /wallet/balance   {access_token}                       -> {money, money_light, all_balance, usable_balance, points}
  POST /wallet/profile   {access_token}                       -> {name, external_user_id, icon}
  POST /link/check       {access_token?, code}                -> {amount, status, sender_name, has_password, order_id, chat_room_id}
  POST /link/receive     {access_token, code, passcode?}      -> {ok, amount}
  POST /alive            {access_token}                       -> {ok}

Auth: Node との通信は X-Sidecar-Secret ヘッダーで共有秘密を検証。
"""
from __future__ import annotations
import os
import sys
import uuid
import threading
from typing import Any
from flask import Flask, request, jsonify

try:
    from paython_wrapper import PayPay, PayPayError, PayPayLoginError, PayPayNetworkError
except ImportError:
    sys.stderr.write("paython-wrapper not installed. Run: pip install paython-wrapper\n")
    raise

SECRET = os.environ.get("SIDECAR_SECRET", "")
PORT   = int(os.environ.get("SIDECAR_PORT", "8787"))
PROXY  = os.environ.get("PAYPAY_PROXY") or None

app = Flask(__name__)

# 進行中ログインセッション (session_id -> PayPay インスタンス)
_pending: dict[str, PayPay] = {}
_lock = threading.Lock()


def _auth() -> bool:
    if not SECRET:
        return True
    return request.headers.get("X-Sidecar-Secret") == SECRET


def _err(msg: str, code: int = 400):
    return jsonify({"error": msg}), code


@app.before_request
def _guard():
    if not _auth():
        return _err("forbidden", 403)


def _from_token(access_token: str) -> PayPay:
    pp = PayPay(access_token=access_token, proxy=PROXY)
    return pp


@app.post("/login/start")
def login_start():
    j = request.get_json(force=True)
    phone, password = j.get("phone"), j.get("password")
    if not phone or not password:
        return _err("phone/password required")
    try:
        pp = PayPay(phone, password, proxy=PROXY)
    except PayPayLoginError as e:
        return _err(f"login_error: {e}", 401)
    except PayPayNetworkError as e:
        return _err(f"network_error: {e}", 502)
    except PayPayError as e:
        return _err(f"paypay_error: {e}", 500)

    sid = str(uuid.uuid4())
    with _lock:
        _pending[sid] = pp
    return jsonify({"session": sid, "needs_url": True})


@app.post("/login/finish")
def login_finish():
    j = request.get_json(force=True)
    sid = j.get("session")
    url = j.get("url")
    if not sid or not url:
        return _err("session/url required")
    with _lock:
        pp = _pending.pop(sid, None)
    if pp is None:
        return _err("session not found", 404)
    try:
        pp.login(url)
    except PayPayLoginError as e:
        return _err(f"login_error: {e}", 401)
    except PayPayError as e:
        return _err(f"paypay_error: {e}", 500)

    # プロフィールも返す
    try:
        prof = pp.get_profile()
        name = prof.name
        ext  = prof.external_user_id
    except Exception:
        name, ext = None, None

    return jsonify({
        "access_token":  pp.access_token,
        "refresh_token": pp.refresh_token,
        "device_uuid":   pp.device_uuid,
        "external_user_id": ext,
        "name": name,
    })


@app.post("/token/refresh")
def token_refresh():
    j = request.get_json(force=True)
    rt = j.get("refresh_token")
    if not rt:
        return _err("refresh_token required")
    pp = PayPay(proxy=PROXY)
    try:
        pp.token_refresh(rt)
    except PayPayLoginError as e:
        return _err(f"login_error: {e}", 401)
    except PayPayError as e:
        return _err(f"paypay_error: {e}", 500)
    return jsonify({
        "access_token": pp.access_token,
        "refresh_token": pp.refresh_token,
    })


@app.post("/wallet/balance")
def wallet_balance():
    j = request.get_json(force=True)
    at = j.get("access_token")
    if not at:
        return _err("access_token required")
    try:
        b = _from_token(at).get_balance()
    except PayPayLoginError as e:
        return _err(f"login_error: {e}", 401)
    except PayPayError as e:
        return _err(f"paypay_error: {e}", 500)
    return jsonify({
        "money": b.money,
        "money_light": b.money_light,
        "all_balance": b.all_balance,
        "usable_balance": b.usable_balance,
        "points": b.points,
    })


@app.post("/wallet/profile")
def wallet_profile():
    j = request.get_json(force=True)
    at = j.get("access_token")
    try:
        p = _from_token(at).get_profile()
    except PayPayError as e:
        return _err(f"paypay_error: {e}", 500)
    return jsonify({
        "name": p.name,
        "external_user_id": p.external_user_id,
        "icon": p.icon,
    })


@app.post("/link/check")
def link_check():
    j = request.get_json(force=True)
    at = j.get("access_token")
    code = j.get("code")
    if not code:
        return _err("code required")
    try:
        if at:
            info = _from_token(at).link_check(code)
        else:
            info = PayPay(proxy=PROXY).link_check(code, web_api=True)
    except PayPayError as e:
        return _err(f"paypay_error: {e}", 500)
    return jsonify({
        "amount": info.amount,
        "status": info.status,
        "sender_name": info.sender_name,
        "sender_external_user_id": info.sender_external_user_id,
        "has_password": info.has_password,
        "order_id": info.order_id,
        "chat_room_id": info.chat_room_id,
    })


@app.post("/link/receive")
def link_receive():
    j = request.get_json(force=True)
    at = j.get("access_token")
    code = j.get("code")
    passcode = j.get("passcode")
    if not at or not code:
        return _err("access_token/code required")
    pp = _from_token(at)
    try:
        info = pp.link_check(code)
        if info.status != "PENDING":
            return _err(f"link not pending (status={info.status})", 409)
        if info.has_password and not passcode:
            return _err("passcode required", 400)
        pp.link_receive(code, passcode=passcode)
    except PayPayLoginError as e:
        return _err(f"login_error: {e}", 401)
    except PayPayError as e:
        return _err(f"paypay_error: {e}", 500)
    return jsonify({"ok": True, "amount": info.amount, "order_id": info.order_id})


@app.post("/wallet/create_link")
def wallet_create_link():
    j = request.get_json(force=True)
    at = j.get("access_token")
    amount = j.get("amount")
    passcode = j.get("passcode")
    if not at or amount is None:
        return _err("access_token/amount required")
    try:
        link = _from_token(at).create_link(amount=int(amount), passcode=passcode)
    except PayPayLoginError as e:
        return _err(f"login_error: {e}", 401)
    except PayPayError as e:
        return _err(f"paypay_error: {e}", 500)
    return jsonify({
        "link":        link.link,
        "chat_room_id":link.chat_room_id,
        "order_id":    link.order_id,
    })


@app.post("/alive")
def alive():
    j = request.get_json(force=True)
    at = j.get("access_token")
    try:
        _from_token(at).alive()
    except PayPayError as e:
        return _err(f"paypay_error: {e}", 500)
    return jsonify({"ok": True})


@app.get("/health")
def health():
    return jsonify({"ok": True, "pending_logins": len(_pending)})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=PORT, threaded=True)
