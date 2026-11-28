// paython-wrapper client.py の TypeScript 忠実ポート。
// 動作可能範囲: access_token / refresh_token を事前に取得してある運用ケース
// (新規ログインは _bypass_waf に Selenium 相当が必要で、MWS では Puppeteer 非対応のため不可)。

import axios, { type AxiosInstance } from 'axios';
import { wrapper as axiosCookieJarSupport } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'node:crypto';

import {
  BFF, PORTAL, P2P, CLIENT_ID, REDIRECT_URI, APP_VERSION,
  appHeaders, webviewHeaders, apiHeaders,
} from './constants.js';
import { generateDeviceState, type DeviceState } from './device.js';
import { generatePkcePair, generateCodeVerifier } from './pkce.js';
import { extractLinkId, parseRequestId, stripPhoneHyphen, type ProxySpec } from './util.js';
import {
  PayPayError, PayPayLoginError, PayPayNetworkError, P2PTemporaryHoldError,
} from './errors.js';
import type {
  Balance, Profile, LinkInfo, CreatedLink, TokenResponse,
  SendMoneyResult, P2PCode, InitializeChatRoom, CashoutResult, P2PUser, BarcodeInfo, PayQRCodeResult,
} from './types.js';

export interface PayPayOptions {
  phone?: string;
  password?: string;
  device_uuid?: string;
  client_uuid?: string;
  access_token?: string;
  refresh_token?: string;
  proxy?: ProxySpec;
}

export class PayPay {
  public access_token: string | null = null;
  public refresh_token: string | null = null;
  public readonly device_uuid: string;
  private readonly _client_uuid: string;
  private _dev: DeviceState;
  private _headers: Record<string, string>;
  private _code_verifier: string | null = null;
  private readonly _params = { payPayLang: 'ja' } as const;

  private readonly _http: AxiosInstance;
  private readonly _jar: CookieJar;

  constructor(opts: PayPayOptions = {}) {
    let { phone, password, device_uuid, client_uuid, access_token, refresh_token, proxy } = opts;
    if (phone) phone = stripPhoneHyphen(phone);

    this._jar = new CookieJar();
    this._client_uuid = client_uuid ?? uuidv4();
    this.device_uuid = device_uuid ?? uuidv4();
    this._dev = generateDeviceState();
    this._headers = appHeaders(this.device_uuid, this._client_uuid, this._dev);

    // axios instance with cookie-jar support
    const axInst = axios.create({
      proxy: this._resolveProxy(proxy),
      validateStatus: () => true,  // ステータスコードは手動で判定
      timeout: 30_000,
      jar: this._jar as any,
      withCredentials: true,
    } as any);
    this._http = axiosCookieJarSupport(axInst);

    if (access_token) {
      this.access_token = access_token;
      this.refresh_token = refresh_token ?? null;
      this._headers['Authorization'] = `Bearer ${access_token}`;
      this._headers['content-type'] = 'application/json';
    } else if (phone && password) {
      // 同期コンストラクタでは async を走らせられないので caller に init() を呼ばせる
      throw new Error('phone/password login requires: new PayPay({ phone, password }); then await paypay.doPasswordLogin();');
    }
  }

  private _resolveProxy(proxy: ProxySpec): any {
    if (!proxy) return false;
    if (typeof proxy === 'string') {
      const url = proxy.startsWith('http') ? proxy : `http://${proxy}`;
      const u = new URL(url);
      return {
        protocol: u.protocol.replace(':', ''),
        host: u.hostname,
        port: Number(u.port) || 80,
      };
    }
    return proxy;
  }

  // ============================================================
  // ログイン一式
  // ============================================================

  /**
   * phone + password で OTL (SMS 認証) フローを開始する。SMS URL を受け取ったら
   * `login(url)` を呼び出す。device_uuid が登録済みなら OTL スキップで token 交換まで一気に進む。
   */
  async doPasswordLogin(phone: string, password: string, hasDeviceUuid: boolean): Promise<void> {
    phone = stripPhoneHyphen(phone);

    // 1. PAR
    const { verifier, challenge } = generatePkcePair(43);
    this._code_verifier = verifier;
    const parPayload = new URLSearchParams({
      clientId: CLIENT_ID,
      clientAppVersion: APP_VERSION,
      clientOsVersion: '29.0.0',
      clientOsType: 'ANDROID',
      redirectUri: REDIRECT_URI,
      responseType: 'code',
      state: generateCodeVerifier(43),
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      scope: 'REGULAR',
      tokenVersion: 'v2',
      prompt: '',
      uiLocales: 'ja',
    });
    const parResp = await this._http.post(`${BFF}/v2/oauth2/par?payPayLang=ja`, parPayload, {
      headers: this._headers,
    });
    const parData = this._raiseIfNotOk(parResp, PayPayNetworkError);
    const requestUri: string = parData.payload.requestUri;

    // 2. Authorize
    const wvHeaders = webviewHeaders();
    const authResp = await this._http.get(`${PORTAL}/api/v2/oauth2/authorize`, {
      headers: wvHeaders,
      params: { client_id: CLIENT_ID, request_uri: requestUri },
    });
    if (authResp.status === 202) {
      await this._bypassWaf(
        `${PORTAL}/api/v2/oauth2/authorize?client_id=${CLIENT_ID}&request_uri=${requestUri}`
      );
    } else if (authResp.status !== 200) {
      throw new PayPayNetworkError(`Authorization page failed (HTTP ${authResp.status})`);
    }

    // 3. サインインページ
    await this._http.get(`${PORTAL}/oauth2/sign-in`, {
      headers: wvHeaders,
      params: { client_id: CLIENT_ID, mode: 'landing' },
    });

    // 4. PAR check
    const parCheckHdrs = apiHeaders(`${PORTAL}/oauth2/sign-in?client_id=${CLIENT_ID}&mode=landing`);
    const parCheck = (await this._http.get(`${PORTAL}/api/v2/oauth2/par/check`, { headers: parCheckHdrs })).data;
    this._check(parCheck);

    // 5. パスワード送信
    const pwResp = (await this._http.post(
      `${PORTAL}/api/v2/oauth2/sign-in/password`,
      { username: phone, password, signInAttemptCount: 1 },
      { headers: apiHeaders(`${PORTAL}/oauth2/sign-in?client_id=${CLIENT_ID}&mode=landing`) },
    )).data;
    this._check(pwResp);

    // 6. 分岐
    if (hasDeviceUuid) {
      await this._exchangeCode(pwResp);
    } else {
      await this._startOtlFlow();
    }
  }

  private async _bypassWaf(_url: string): Promise<void> {
    // paython-wrapper は Selenium headless Chrome で AWS WAF の JS チャレンジを解いて
    // cookie を session に流し込んでいた。Node 版では Puppeteer を使う必要があるが
    // MWS (メモリ 400MB) では Chromium を立てられない。
    //
    // → 運用: ローカル開発機で token を 1 回取得して DB に保存 → 本番は refresh で回す。
    throw new PayPayNetworkError(
      'WAF bypass is not supported in this Node port. Obtain access_token / refresh_token on a dev machine (puppeteer + headless Chrome) and pass them to new PayPay({ access_token, refresh_token }).'
    );
  }

  private async _exchangeCode(pwResp: any): Promise<void> {
    const rawUri: string | undefined = pwResp?.payload?.redirectUrl;
    if (!rawUri) throw new PayPayLoginError('登録されていない Device-UUID です');
    const code = parseRequestId(rawUri);

    delete this._headers['Device-Lock-Type'];
    delete this._headers['Device-Lock-App-Setting'];

    const resp = await this._http.post(
      `${BFF}/v2/oauth2/token`,
      new URLSearchParams({
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        code,
        codeVerifier: this._code_verifier ?? '',
      }),
      { headers: this._headers, params: this._params },
    );
    const data = resp.data;
    this._check(data);
    this._applyTokens(data);
  }

  private async _startOtlFlow(): Promise<void> {
    const makeHdrs = (refPath: string) => apiHeaders(`${PORTAL}${refPath}`);
    let hdrs = makeHdrs(`/oauth2/sign-in?client_id=${CLIENT_ID}&mode=landing`);

    const r1 = (await this._http.post(
      `${PORTAL}/api/v2/oauth2/extension/code-grant/update`, {}, { headers: hdrs },
    )).data;
    this._check(r1);

    hdrs = makeHdrs(`/oauth2/verification-method?client_id=${CLIENT_ID}&mode=navigation-2fa`);
    const selectPayload = {
      params: {
        extension_id: 'user-main-2fa-v1',
        data: {
          type: 'SELECT_FLOW',
          payload: {
            flow: 'OTL',
            sign_in_method: 'MOBILE',
            base_url: `${PORTAL}/oauth2/l`,
          },
        },
      },
    };
    const r2 = (await this._http.post(
      `${PORTAL}/api/v2/oauth2/extension/code-grant/update`, selectPayload, { headers: hdrs },
    )).data;
    this._check(r2);

    hdrs = makeHdrs(`/oauth2/otl-request?client_id=${CLIENT_ID}&mode=navigation-2fa`);
    const r3 = (await this._http.post(
      `${PORTAL}/api/v2/oauth2/extension/code-grant/side-channel/next-action-polling`,
      { waitUntil: 'PT5S' }, { headers: hdrs },
    )).data;
    this._check(r3);
    // SMS で OTL が届く → login() で続行
  }

  async login(urlOrId: string): Promise<TokenResponse> {
    const code = extractLinkId(urlOrId);
    const otlHeaders = apiHeaders(`${PORTAL}/oauth2/l?id=${code}&client_id=${CLIENT_ID}`);

    const verify = (await this._http.post(
      `${PORTAL}/api/v2/oauth2/extension/sign-in/2fa/otl/verify`,
      { code }, { headers: otlHeaders },
    )).data;
    this._check(verify);

    const complete = (await this._http.post(
      `${PORTAL}/api/v2/oauth2/extension/code-grant/update`,
      { params: { extension_id: 'user-main-2fa-v1', data: { type: 'COMPLETE_OTL', payload: null } } },
      { headers: otlHeaders },
    )).data;
    this._check(complete);

    const rawUri = complete?.payload?.redirect_uri;
    if (!rawUri) throw new PayPayLoginError(`redirect_uri が見つかりませんでした\n${JSON.stringify(complete)}`);
    const code2 = parseRequestId(String(rawUri).replace(`${REDIRECT_URI}?`, ''));

    delete this._headers['Device-Lock-Type'];
    delete this._headers['Device-Lock-App-Setting'];

    const tokenResp = (await this._http.post(
      `${BFF}/v2/oauth2/token`,
      new URLSearchParams({
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        code: code2,
        codeVerifier: this._code_verifier ?? '',
      }),
      { headers: this._headers, params: this._params },
    )).data as TokenResponse;
    this._check(tokenResp);
    this._applyTokens(tokenResp);
    return tokenResp;
  }

  /**
   * refresh_token で access_token を更新。paython-wrapper と同じく、インスタンスに
   * access_token が既にセットされている必要がある (期限切れでも可)。
   */
  async tokenRefresh(refreshToken: string): Promise<TokenResponse> {
    if (!this.access_token) throw new PayPayLoginError('まずはログインしてください');

    const resp = (await this._http.post(
      `${BFF}/v2/oauth2/refresh`,
      new URLSearchParams({
        clientId: CLIENT_ID,
        refreshToken,
        tokenVersion: 'v2',
      }),
      { headers: this._headers },
    )).data as TokenResponse;

    const rc = resp?.header?.resultCode;
    if (rc === 'S0001' || rc === 'S1003' || rc === 'S0003') throw new PayPayLoginError(resp, resp);
    if (rc !== 'S0000') throw new PayPayError(resp, resp);

    this._applyTokens(resp);
    return resp;
  }

  // ============================================================
  // 内部ヘルパー
  // ============================================================

  private _refreshDeviceState(): void {
    this._dev = generateDeviceState();
    this._headers['Device-Orientation'] = this._dev.orientation;
    this._headers['Device-Orientation-2'] = this._dev.orientation_2;
    this._headers['Device-Rotation'] = this._dev.rotation;
    this._headers['Device-Rotation-2'] = this._dev.rotation_2;
    this._headers['Device-Acceleration'] = this._dev.acceleration;
    this._headers['Device-Acceleration-2'] = this._dev.acceleration_2;
  }

  private _applyTokens(resp: TokenResponse): void {
    this.access_token = resp.payload.accessToken;
    this.refresh_token = resp.payload.refreshToken;
    this._headers['Authorization'] = `Bearer ${this.access_token}`;
    this._headers['content-type'] = 'application/json';
    this._refreshDeviceState();
  }

  private _check(resp: any): void {
    const rc = resp?.header?.resultCode;
    if (rc === 'S0001') throw new PayPayLoginError(resp, resp);
    if (rc !== 'S0000') throw new PayPayError(resp, resp);
  }

  private _raiseIfNotOk(resp: { status: number; data: any }, ExcCls: typeof PayPayError = PayPayError): any {
    if (typeof resp.data !== 'object' || resp.data === null) {
      throw new PayPayNetworkError('日本以外からは接続できません');
    }
    const rc = resp.data?.header?.resultCode;
    if (rc === 'S0001') throw new PayPayLoginError(resp.data, resp.data);
    if (rc !== 'S0000') throw new ExcCls(resp.data, resp.data);
    return resp.data;
  }

  private _requireAuth(): void {
    if (!this.access_token) throw new PayPayLoginError('まずはログインしてください');
  }

  // ============================================================
  // 残高 / プロフィール
  // ============================================================

  async getBalance(): Promise<Balance> {
    this._requireAuth();
    const resp = (await this._http.get(`${BFF}/v1/getBalanceInfo`, {
      headers: this._headers,
      params: {
        includePendingBonusLite: 'false',
        includePending: 'true',
        noCache: 'true',
        includeKycInfo: 'true',
        includePayPaySecuritiesInfo: 'true',
        includePointInvestmentInfo: 'true',
        includePayPayBankInfo: 'true',
        includeGiftVoucherInfo: 'true',
        payPayLang: 'ja',
      },
    })).data;
    this._check(resp);
    const wallet = resp.payload.walletDetail;
    const summary = resp.payload.walletSummary;
    let money: number | null;
    try { money = wallet.emoneyBalanceInfo.balance; } catch { money = null; }
    return {
      money: money ?? null,
      money_light: wallet.prepaidBalanceInfo.balance,
      all_balance: summary.allTotalBalanceInfo.balance,
      usable_balance: summary.usableBalanceInfoWithoutCashback.balance,
      points: wallet.cashBackBalanceInfo.balance,
      raw: resp,
    };
  }

  async getProfile(): Promise<Profile> {
    this._requireAuth();
    const resp = (await this._http.get(`${BFF}/v2/getProfileDisplayInfo`, {
      headers: this._headers,
      params: {
        includeExternalProfileSync: 'true',
        completedOptionalTasks: 'ENABLED_NEARBY_DEALS',
        payPayLang: 'ja',
      },
    })).data;
    this._check(resp);
    const p = resp.payload.userProfile;
    return { name: p.nickName, external_user_id: p.externalUserId, icon: p.avatarImageUrl, raw: resp };
  }

  // ============================================================
  // 送金リンク
  // ============================================================

  async linkCheck(urlOrId: string, webApi = false): Promise<LinkInfo> {
    const linkId = extractLinkId(urlOrId);
    let info: any;
    if (webApi) {
      info = (await this._http.get('https://www.paypay.ne.jp/app/v2/p2p-api/getP2PLinkInfo', {
        params: { verificationCode: linkId },
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Content-Type': 'application/json',
        },
      })).data;
    } else {
      this._requireAuth();
      info = (await this._http.get(`${BFF}/v2/getP2PLinkInfo`, {
        headers: this._headers,
        params: { verificationCode: linkId, payPayLang: 'ja' },
      })).data;
    }
    this._check(info);
    const p = info.payload;
    const sender = p.sender;
    const msg = p.message.data;
    const pending = p.pendingP2PInfo;
    return {
      sender_name: sender.displayName,
      sender_external_user_id: sender.externalId,
      sender_icon: sender.photoUrl,
      order_id: pending.orderId,
      chat_room_id: p.message.chatRoomId,
      amount: pending.amount,
      status: msg.status,
      money_light: msg.subWalletSplit.senderPrepaidAmount,
      money: msg.subWalletSplit.senderEmoneyAmount,
      has_password: pending.isSetPasscode,
      raw: info,
    };
  }

  async linkReceive(urlOrId: string, passcode?: string, linkInfo?: any): Promise<any> {
    this._requireAuth();
    const linkId = extractLinkId(urlOrId);

    if (!linkInfo) {
      linkInfo = (await this._http.get(`${BFF}/v2/getP2PLinkInfo`, {
        headers: this._headers,
        params: { verificationCode: linkId, payPayLang: 'ja' },
      })).data;
    }
    this._check(linkInfo);

    if (linkInfo.payload.orderStatus !== 'PENDING') {
      throw new PayPayError('すでに 受け取り / 辞退 / キャンセル されているリンクです');
    }
    let pw: string | null = null;
    if (linkInfo.payload.pendingP2PInfo.isSetPasscode) {
      if (!passcode) throw new PayPayError('このリンクにはパスワードが設定されています');
      pw = passcode;
    }

    const payload = {
      requestId: uuidv4(),
      orderId: linkInfo.payload.pendingP2PInfo.orderId,
      verificationCode: linkId,
      passcode: pw,
      senderMessageId: linkInfo.payload.message.messageId,
      senderChannelUrl: linkInfo.payload.message.chatRoomId,
    };

    const resp = await this._http.post(`${BFF}/v2/acceptP2PSendMoneyLink`, payload, {
      headers: this._headers,
      params: { payPayLang: 'ja', appContext: 'P2PMoneyTransferDetailScreen_linkReceiver' },
    });
    const data = resp.data;
    if (typeof data !== 'object') throw new PayPayNetworkError('日本以外からは接続できません');
    const rc = data?.header?.resultCode;
    if (rc === 'S0001') throw new PayPayLoginError(data, data);
    if (rc !== 'S0000') {
      if (data?.error?.backendResultCode === '42007013') throw new P2PTemporaryHoldError(data, data);
      throw new PayPayError(data, data);
    }
    return data;
  }

  async createLink(amount: number, passcode?: string, pochibukuro = false, theme = 'default-sendmoney'): Promise<CreatedLink> {
    this._requireAuth();
    const payload: Record<string, any> = {
      requestId: uuidv4(),
      amount,
      socketConnection: 'P2P',
      theme: pochibukuro ? 'pochibukuro' : theme,
      source: 'sendmoney_home_sns',
      ackPhoneCallDetected: false,
    };
    if (passcode) payload.passcode = passcode;

    const resp = await this._http.post(`${BFF}/v2/executeP2PSendMoneyLink`, payload, {
      headers: this._headers,
      params: this._params,
    });
    const data = resp.data;
    if (typeof data !== 'object') throw new PayPayNetworkError('日本以外からは接続できません');
    this._check(data);
    return {
      link: data.payload.link,
      chat_room_id: data.payload.chatRoomId,
      order_id: data.payload.orderId,
      raw: data,
    };
  }

  /** 特定ユーザー (external_user_id) に対する直接送金。
   *  S4002 (リスク警告) が返った場合は 5 秒待って ack フラグを立てて再試行する。 */
  async sendMoney(
    amount: number,
    receiverId: string,
    pochibukuro = false,
    theme = 'default-sendmoney',
  ): Promise<SendMoneyResult> {
    this._requireAuth();
    const payloadTheme = pochibukuro ? 'pochibukuro' : theme;
    const build = (ackRiskError: boolean, ackPhoneCallDetected: boolean) => ({
      amount,
      theme: payloadTheme,
      requestId: uuidv4(),
      externalReceiverId: receiverId,
      ackRiskError,
      ackPhoneCallDetected,
      source: 'sendmoney_history_chat',
      qrCodeId: '',
      metricMetadata: { timestamp: Date.now() / 1000 },
    });

    let resp = (await this._http.post(`${P2P}/v3/executeP2PSendMoney`, build(false, false), {
      headers: this._headers,
      params: this._params,
    })).data;
    if (typeof resp !== 'object') throw new PayPayNetworkError('日本以外からは接続できません');
    if (resp?.header?.resultCode === 'S4002') {
      await new Promise(ok => setTimeout(ok, 5000));
      resp = (await this._http.post(`${P2P}/v3/executeP2PSendMoney`, build(true, true), {
        headers: this._headers,
        params: this._params,
      })).data;
      if (typeof resp !== 'object') throw new PayPayNetworkError('日本以外からは接続できません');
    }
    this._check(resp);
    return { chat_room_id: resp.payload.chatRoomId, order_id: resp.payload.orderId, raw: resp };
  }

  /** send_message: 指定チャットルームへのテキスト送信。 */
  async sendMessage(chatRoomId: string, message: string): Promise<any> {
    this._requireAuth();
    const payload = {
      channelUrl: chatRoomId,
      message,
      socketConnection: 'P2P',
      metricMetadata: { timestamp: Date.now() / 1000 },
    };
    const resp = (await this._http.post(`${P2P}/v1/sendP2PMessage`, payload, {
      headers: this._headers, params: this._params,
    })).data;
    this._check(resp);
    return resp;
  }

  /** create_p2pcode: 受け取り用 QR コード (金額任意) を発行。 */
  async createP2PCode(amount?: number): Promise<P2PCode> {
    this._requireAuth();
    const payload: Record<string, any> = { amount: null, sessionId: null };
    if (amount) {
      payload.amount = amount;
      payload.sessionId = uuidv4();
    }
    const resp = (await this._http.post(`${BFF}/v1/createP2PCode`, payload, {
      headers: this._headers, params: this._params,
    })).data;
    this._check(resp);
    return { p2pcode: resp.payload.p2pCode, raw: resp };
  }

  /** set_money_priority: PayPay マネー優先 / マネーライト優先の切り替え。 */
  async setMoneyPriority(paypayMoney = false): Promise<any> {
    this._requireAuth();
    const payload = { moneyPriority: paypayMoney ? 'MONEY_FIRST' : 'MONEY_LITE_FIRST' };
    const resp = (await this._http.post(`${P2P}/v1/setMoneyPriority`, payload, {
      headers: this._headers, params: { payPayLang: 'ja' },
    })).data;
    this._check(resp);
    return resp;
  }

  /** get_chat_rooms: P2P チャットルーム一覧 (最大 size 件)。 */
  async getChatRooms(size = 20, lastMessage = true): Promise<any> {
    this._requireAuth();
    const params = {
      pageSize: String(size),
      customTypes: 'P2P_CHAT,P2P_OLD,P2P_CHAT_INACTIVE,P2P_LINK,P2P_PUBLIC_GROUP_CHAT',
      requiresLastMessage: String(lastMessage),
      socketConnection: 'P2P',
      payPayLang: 'ja',
    };
    const resp = (await this._http.get(`${P2P}/v1/getP2PChatRoomListLite`, {
      headers: this._headers, params,
    })).data;
    this._check(resp);
    return resp;
  }

  /** get_chat_room_messages: 指定チャットルームのメッセージ一覧。 */
  async getChatRoomMessages(chatRoomId: string, prev = 15, next = 0, include = false): Promise<any> {
    this._requireAuth();
    const params = {
      chatRoomId,
      include: String(include),
      prev: String(prev),
      next: String(next),
      payPayLang: 'ja',
    };
    const resp = (await this._http.get(`${P2P}/v1/getP2PMessageList`, {
      headers: this._headers, params,
    })).data;
    this._check(resp);
    return resp;
  }

  /** get_history: 取引履歴 (任意で CASHBACK のみ)。 */
  async getHistory(size = 20, cashback = false): Promise<any> {
    this._requireAuth();
    const params: Record<string, string> = {
      pageSize: String(size),
      orderTypes: cashback ? 'CASHBACK' : '',
      paymentMethodTypes: '',
      signUpCompletedAt: '2021-01-02T10:16:24Z',
      isOverdraftOnly: 'false',
      payPayLang: 'ja',
    };
    const resp = (await this._http.get(`${BFF}/v4/getPaymentHistory`, {
      headers: this._headers, params,
    })).data;
    this._check(resp);
    return resp;
  }

  /** get_point_history: ポイント (CASHBACK) 履歴のみ。 */
  async getPointHistory(): Promise<any> {
    this._requireAuth();
    const params = {
      pageSize: '20',
      orderTypes: 'CASHBACK',
      paymentMethodTypes: '',
      signUpCompletedAt: '2021-01-02T10:16:24Z',
      pointType: 'REGULAR',
      isOverdraftOnly: 'false',
      payPayLang: 'ja',
    };
    const resp = (await this._http.get(`${BFF}/v4/getPaymentHistory`, {
      headers: this._headers, params,
    })).data;
    this._check(resp);
    return resp;
  }

  /** search_p2puser: external_user_id 検索。is_global=true でグローバル検索。 */
  async searchP2PUser(userId: string, size = 10, isGlobal = false, order = 0): Promise<P2PUser> {
    this._requireAuth();
    const payload: Record<string, any> = {
      searchTerm: userId,
      pageToken: '',
      pageSize: size,
      isIngressSendMoney: false,
      searchTypes: isGlobal ? 'GLOBAL_SEARCH' : 'FRIEND_AND_CANDIDATE_SEARCH',
    };
    const resp = (await this._http.post(`${P2P}/v3/searchP2PUser`, payload, {
      headers: this._headers, params: this._params,
    })).data;
    this._check(resp);
    if (resp.payload.searchResultEnum === 'NO_USERS_FOUND') {
      throw new PayPayError('ユーザーが見つかりませんでした', resp);
    }
    let name: string, icon: string, external_user_id: string;
    if (isGlobal) {
      const r = resp.payload.globalSearchResult;
      name = r.displayName; icon = r.photoUrl; external_user_id = r.externalId;
    } else {
      const r = resp.payload.friendsAndCandidatesSearchResults.friends[order];
      name = r.displayName; icon = r.photoUrl; external_user_id = r.externalId;
    }
    return { name, icon, external_user_id, raw: resp };
  }

  /** initialize_chatroom: 指定ユーザー (external_user_id) とのチャットルームを初期化。 */
  async initializeChatRoom(externalUserId: string): Promise<InitializeChatRoom> {
    this._requireAuth();
    const payload = {
      returnChatRoom: true,
      shouldCheckMessageForFriendshipAppeal: true,
      externalUserId,
      socketConnection: 'P2P',
    };
    const resp = (await this._http.post(`${P2P}/v1/initialiseOneToOneAndLinkChatRoom`, payload, {
      headers: this._headers, params: this._params,
    })).data;
    this._check(resp);
    return { chatroom_id: resp.payload.chatRoom.chatRoomId, raw: resp };
  }

  /** get_barcode_info: 支払い用 QR 情報取得。 */
  async getBarcodeInfo(url: string): Promise<BarcodeInfo> {
    this._requireAuth();
    const params = { code: url, payPayLang: 'ja' };
    const resp = (await this._http.get(`${BFF}/v2/getBarcodeInfo`, {
      headers: this._headers, params,
    })).data;
    this._check(resp);
    const u = resp.payload.userCodeInfo;
    return {
      amount: u.amount,
      user_name: u.userInfo.displayName,
      external_user_id: u.userInfo.externalUserId,
      user_icon: u.userInfo.avatarImageUrl,
      raw: resp,
    };
  }

  /** cashout_to_paypaybank: PayPay 銀行への自動出金。 */
  async cashoutToPayPayBank(amount: number): Promise<CashoutResult> {
    this._requireAuth();
    const display = (await this._http.get(`${BFF}/v2/getPayoutDisplayInfo`, {
      headers: this._headers, params: { payPayLang: 'ja' },
    })).data;
    this._check(display);
    const methods: any[] = display.payload.selfPayoutMethodInfoList ?? [];
    const target = methods.find(m => m?.payoutBankInfo?.bankName === 'PayPay銀行');
    if (!target) throw new PayPayError('PayPay 銀行の出金口座が登録されていません', display);
    const payload = {
      amount,
      payoutMethodId: target.id,
      requestId: uuidv4(),
      agreeSimilarTransactionFlag: false,
      senderName: 'ＰＡＹＰＡＹ',
    };
    const resp = (await this._http.post(`${BFF}/v2/executePayout`, payload, {
      headers: this._headers, params: this._params,
    })).data;
    this._check(resp);
    const info = resp.payload.paymentInfo.orderTypeSpecificInfo.payoutInfo;
    return {
      bank_name: info.bankName,
      bank_account_type: info.bankAccountType,
      bank_branch_name: info.bankBranchName,
      bank_account_number: info.bankAccountNumber,
    };
  }

  /** pay_qr_code: 動的 QR の支払い実行。 */
  async payQrCode(url: string): Promise<PayQRCodeResult> {
    this._requireAuth();
    let code = url;
    if (code.includes('https://qr.paypay.ne.jp/')) code = code.replace('https://qr.paypay.ne.jp/', '');
    const barcodeInfo = (await this._http.get(`${BFF}/v2/getBarcodeInfo`, {
      headers: this._headers,
      params: { code: `https://qr.paypay.ne.jp/${code}`, payPayLang: 'ja', isScannedFromFile: 'false' },
    })).data;
    this._check(barcodeInfo);
    const info = barcodeInfo.payload;
    const amount = info.codeInfo.dynamicCodeInfo.amount;
    const paymentMethodId = info.paymentMethodInfo.paymentMethodIdString;
    const merchantId = info.codeInfo.dynamicCodeInfo.merchantInfo.merchantId;
    const merchantOrderId = info.codeInfo.dynamicCodeInfo.merchantOrderId;
    const codeValue = info.codeInfo.dynamicCodeInfo.code;

    const payload = {
      requestId: uuidv4(),
      merchantId,
      storeId: '',
      stickerId: '',
      amount,
      currency: 'JPY',
      paymentMethodId,
      paymentMethodType: 'WALLET',
      agreeSimilarTransactionFlag: false,
      code: codeValue,
      merchantOrderId,
      mode: 'DYNAMIC_QR',
    };
    const resp = (await this._http.post(`${BFF}/v2/executePayment`, payload, {
      headers: this._headers, params: { payPayLang: 'ja' },
    })).data;
    this._check(resp);
    const p = resp.payload.paymentInfo;
    return {
      order_id: p.orderInfo.orderId,
      order_status: p.orderInfo.statusInfo.orderStatus,
      amount: p.participantDetails.amountDetail.amount.value,
      merchant_name: p.participantDetails.title,
      raw: resp,
    };
  }

  async linkCancel(urlOrId: string, linkInfo?: any): Promise<any> {
    this._requireAuth();
    const linkId = extractLinkId(urlOrId);

    if (!linkInfo) {
      linkInfo = (await this._http.get(`${BFF}/v2/getP2PLinkInfo`, {
        headers: this._headers,
        params: { verificationCode: linkId, payPayLang: 'ja' },
      })).data;
    }
    this._check(linkInfo);
    if (linkInfo.payload.orderStatus !== 'PENDING') {
      throw new PayPayError('すでに 受け取り / 辞退 / キャンセル されているリンクです');
    }
    const payload = {
      orderId: linkInfo.payload.pendingP2PInfo.orderId,
      requestId: uuidv4(),
      verificationCode: linkId,
    };
    const resp = (await this._http.post(`${P2P}/v1/cancelP2PSendMoneyLink`, payload, {
      headers: this._headers,
      params: this._params,
    })).data;
    this._check(resp);
    return resp;
  }

  async linkReject(urlOrId: string, linkInfo?: any): Promise<any> {
    this._requireAuth();
    const linkId = extractLinkId(urlOrId);

    if (!linkInfo) {
      linkInfo = (await this._http.get(`${BFF}/v2/getP2PLinkInfo`, {
        headers: this._headers,
        params: { verificationCode: linkId, payPayLang: 'ja' },
      })).data;
    }
    this._check(linkInfo);
    if (linkInfo.payload.orderStatus !== 'PENDING') {
      throw new PayPayError('すでに 受け取り / 辞退 / キャンセル されているリンクです');
    }
    const payload = {
      requestId: uuidv4(),
      orderId: linkInfo.payload.pendingP2PInfo.orderId,
      verificationCode: linkId,
      senderMessageId: linkInfo.payload.message.messageId,
      senderChannelUrl: linkInfo.payload.message.chatRoomId,
    };
    const resp = (await this._http.post(`${BFF}/v2/rejectP2PSendMoneyLink`, payload, {
      headers: this._headers,
      params: this._params,
    })).data;
    this._check(resp);
    return resp;
  }

  // ============================================================
  // Alive (Bot 検知回避のためのダミーリクエスト)
  // PayPaython-mobile v4.3.0 に合わせて 3 本に更新:
  //   getGlobalServiceStatus → getHomeDisplayInfo (v4) → getFeatureFlags
  // ============================================================

  async alive(): Promise<void> {
    this._requireAuth();
    const r1 = (await this._http.get(`${BFF}/v1/getGlobalServiceStatus`, {
      headers: this._headers,
      params: { payPayLang: 'ja' },
    })).data;
    this._check(r1);
    await this._http.post(`${BFF}/v4/getHomeDisplayInfo`, {
      abTestFlags: { dedupeFeatureAndFavoritesTab: false },
      excludeMissionBannerInfoFlag: false,
      excludeTobaccoPolicyBannerFlag: true,
      includeAge: true,
      includeBeginnerFlag: false,
      includeSkinInfoFlag: false,
      networkStatus: 'WIFI',
    }, { headers: this._headers, params: { payPayLang: 'ja' } });
    await this._http.post(`${BFF}/v1/getFeatureFlags`, {
      flagNames: [
        'enable_home_screen_favoriting_suggestions',
        'home_screen_all_entry_point_ab_test',
        'enable_cache_encryption_engine',
        'credit-card-maintenance-in-progress',
        'vpc_home_merchant_list',
        'aws_iot_core_migration_enabled',
        'enable_insufficient_balance_topup_android',
        'is_post_payment_route_migration_enabled',
        'enable_transaction_history_migration_android',
        'enable_nc_redesign',
        'nearby_halfsheet_combined_ab_test',
        'home-screen/p2p_tab_bar_item',
        'cashback_sound_multiplier',
        'p2p_chat_room_gift_voucher_nudge',
      ],
    }, { headers: this._headers, params: { payPayLang: 'ja' } });
  }
}

// placeholder for unused imports linter
void createHash;
