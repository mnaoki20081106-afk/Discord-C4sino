// paython-wrapper/responses.py 相当の TypeScript interface

export interface Profile {
  name: string;
  external_user_id: string;
  icon: string;
  raw: any;
}

export interface Balance {
  money: number | null;
  money_light: number;
  all_balance: number;
  usable_balance: number;
  points: number;
  raw: any;
}

export interface LinkInfo {
  sender_name: string;
  sender_external_user_id: string;
  sender_icon: string;
  order_id: string;
  chat_room_id: string;
  amount: number;
  status: string;   // PENDING / COMPLEATED / REJECTED / FAILED
  money_light: number;
  money: number;
  has_password: boolean;
  raw: any;
}

export interface CreatedLink {
  link: string;
  chat_room_id: string;
  order_id: string;
  raw: any;
}

export interface SendMoneyResult {
  chat_room_id: string;
  order_id: string;
  raw: any;
}

export interface P2PCode {
  p2pcode: string;
  raw: any;
}

/** /bff/v2/oauth2/token / /bff/v2/oauth2/refresh のレスポンス payload */
export interface TokenResponsePayload {
  accessToken: string;
  refreshToken: string;
  [k: string]: any;
}
export interface TokenResponse {
  header: { resultCode: string; [k: string]: any };
  payload: TokenResponsePayload;
}
