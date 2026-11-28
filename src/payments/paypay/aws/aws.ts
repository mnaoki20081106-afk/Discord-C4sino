// aws/aws.py の 1:1 TypeScript ポート。
// window.gokuProps + challenge.js の host を HTML から抽出し、PoW or bandwidth challenge を解いて
// aws-waf-token を取得する。

import axios, { type AxiosInstance } from 'axios';
import { CHALLENGE_TYPES } from './verify.js';
import { getFp } from './fingerprint.js';

const BANDWIDTH_SIZES: Record<number, number> = {
  1: 0x400,          // 1024
  2: 0x400 * 10,     // 10240
  3: 0x400 * 100,    // 102400
  4: 0x100000,       // 1048576
  5: 0x100000 * 10,  // 10485760
};

export interface GokuProps { [k: string]: any }

const uniform = (min: number, max: number) => Math.random() * (max - min) + min;
const round1 = (n: number) => Math.round(n * 10) / 10;

export class AwsWaf {
  private session: AxiosInstance;
  private goku_props: GokuProps;
  private user_agent: string;
  private domain: string;
  private endpoint: string;
  private proxy?: string;

  constructor(
    goku_props: GokuProps,
    endpoint: string,
    domain: string,
    user_agent: string = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Safari jp.pay2.app.ios/5.16.0',
    proxy?: string,
  ) {
    this.goku_props = goku_props;
    this.user_agent = user_agent;
    this.domain = domain;
    this.endpoint = endpoint;
    this.proxy = proxy;
    this.session = axios.create({
      timeout: 30_000,
      validateStatus: () => true,
      headers: {
        'connection': 'keep-alive',
        'user-agent': user_agent,
        'accept': '*/*',
        'origin': `https://${domain}`,
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        'referer': `https://${domain}/`,
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'en-US,en;q=0.9',
      },
      proxy: proxy ? false : false,  // tsx / CJS 側のプロキシ経路は client.ts 側で持たせる
    });
  }

  /** HTML から window.gokuProps と challenge.js の host を取り出す。 */
  static extract(html: string): { goku_props: GokuProps; host: string } {
    const idx = html.indexOf('window.gokuProps = ');
    if (idx < 0) throw new Error('window.gokuProps not found in authorize HTML');
    const after = html.slice(idx + 'window.gokuProps = '.length);
    const end = after.indexOf(';');
    const goku_props = JSON.parse(after.slice(0, end));
    const srcIdx = html.indexOf('src="https://');
    if (srcIdx < 0) throw new Error('challenge.js src not found');
    const afterSrc = html.slice(srcIdx + 'src="https://'.length);
    const host = afterSrc.slice(0, afterSrc.indexOf('/challenge.js'));
    return { goku_props, host };
  }

  private async getInputs(): Promise<any> {
    const resp = await this.session.get(`https://${this.endpoint}/inputs?client=browser`);
    return resp.data;
  }

  private buildPayload(inputs: any): { payload: any; endpoint_path: string; solution_data: string | null } {
    const challenge_key: string = inputs.challenge_type ?? '';
    const verify_func = CHALLENGE_TYPES[challenge_key];
    const { checksum, fp } = getFp(this.user_agent);
    const difficulty: number = inputs.difficulty ?? 1;

    let solution: string | null;
    let endpoint_path: string;
    let solution_data: string | null = null;

    if (typeof verify_func === 'string' || challenge_key.includes('ha9fa')) {
      const bw_size = BANDWIDTH_SIZES[difficulty] ?? 1024;
      solution_data = Buffer.alloc(bw_size).toString('base64');
      solution = null;
      endpoint_path = 'mp_verify';
    } else if (typeof verify_func === 'function') {
      solution = verify_func(inputs.challenge.input, checksum, difficulty);
      endpoint_path = 'verify';
    } else {
      throw new Error(`Unknown challenge_type: ${challenge_key}`);
    }

    const payload = {
      challenge: inputs.challenge,
      solution,
      signals: [{ name: 'Zoey', value: { Present: fp } }],
      checksum,
      existing_token: null,
      client: 'Browser',
      domain: this.domain,
      metrics: [
        { name: '2', value: 3, unit: '2' },
        { name: '100', value: 5, unit: '2' },
        { name: '101', value: 1, unit: '2' },
        { name: '102', value: 13, unit: '2' },
        { name: '103', value: 69, unit: '2' },
        { name: '104', value: 0, unit: '2' },
        { name: '105', value: 0, unit: '2' },
        { name: '106', value: 1, unit: '2' },
        { name: '107', value: 0, unit: '2' },
        { name: '108', value: 0, unit: '2' },
        { name: 'undefined', value: 1, unit: '2' },
        { name: '110', value: 0, unit: '2' },
        { name: '111', value: 415, unit: '2' },
        { name: '112', value: 3, unit: '2' },
        { name: 'undefined', value: 3, unit: '2' },
        { name: '3', value: 23, unit: '2' },
        { name: '7', value: 0, unit: '4' },
        { name: '1', value: 552, unit: '2' },
        { name: '4', value: 103, unit: '2' },
        { name: '5', value: 6, unit: '2' },
        { name: '6', value: 661, unit: '2' },
        { name: '0', value: round1(uniform(50, 150)), unit: '2' },
        { name: '8', value: 1, unit: '4' },
      ],
      goku_props: this.goku_props,
    };
    return { payload, endpoint_path, solution_data };
  }

  private async verify(payload: any, endpoint_path: string, solution_data: string | null): Promise<any> {
    const url = `https://${this.endpoint}/${endpoint_path}`;
    if (solution_data) {
      // multipart/form-data: solution_data と solution_metadata の 2 フィールド
      const boundary = `----AwsWafBoundary${Math.random().toString(36).slice(2)}`;
      const parts: Buffer[] = [];
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="solution_data"\r\n\r\n${solution_data}\r\n`));
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="solution_metadata"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(payload)}\r\n--${boundary}--\r\n`,
      ));
      const body = Buffer.concat(parts);
      const resp = await this.session.post(url, body, {
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      });
      return resp.data;
    }
    const resp = await this.session.post(url, payload, {
      headers: { 'content-type': 'application/json' },
    });
    return resp.data;
  }

  /** 1 回で challenge → PoW/bandwidth → token の全部を回す。失敗なら null。 */
  async getToken(): Promise<string | null> {
    const resData = await this.getInputs();
    const inputs = resData.inputs ?? resData;
    if (!inputs) return null;
    const { payload, endpoint_path, solution_data } = this.buildPayload(inputs);
    const resJson = await this.verify(payload, endpoint_path, solution_data);
    return resJson?.token ?? null;
  }
}
