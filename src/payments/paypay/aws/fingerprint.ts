// aws/fingerprint.py の 1:1 TypeScript ポート。
// iOS Safari のブラウザフィンガープリントを生成 → CRC32 → AES-GCM で暗号化。

import { randomUUID, randomInt, randomBytes, createCipheriv } from 'node:crypto';

/** zlib.crc32 相当 (unsigned 32-bit)。標準的なテーブル実装。 */
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf: Buffer): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC32_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** Cryptor: 固定鍵 AES-256-GCM。Python の AESGCM(key).encrypt(iv, pt, None) と同じ出力。 */
export class Cryptor {
  private key = Buffer.from('6f71a512b1e035eaab53d8be73120d3fb68a0ca346b9560aab3e5cdf753d5e98', 'hex');

  encrypt(plaintext: Buffer): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const iv_b64 = iv.toString('base64');
    return `${iv_b64}::${tag.toString('hex')}::${ct.toString('hex')}`;
  }
}

/** encode_with_crc(obj) → (checksum_hex_upper, b"checksum#payload") */
export function encodeWithCrc(obj: any): { checksum: string; data: Buffer } {
  const payload = Buffer.from(JSON.stringify(obj), 'utf-8');
  const crc = crc32(payload);
  const checksum = crc.toString(16).padStart(8, '0').toUpperCase();
  return { checksum, data: Buffer.concat([Buffer.from(checksum), Buffer.from('#'), payload]) };
}

// iPhone のスクリーンサイズ: (width, height, availHeight, colorDepth)
const IPHONE_SCREENS: Array<[number, number, number, number]> = [
  [390, 844, 844, 32],
  [393, 852, 852, 32],
  [430, 932, 932, 32],
  [375, 812, 812, 32],
  [414, 896, 896, 32],
];

// iOS Safari GPU (Apple GPU - no ANGLE / no D3D11)
const GPUS = [
  {
    webgl_unmasked_renderer: 'Apple GPU',
    webgl: [
      {
        webgl_extensions: 'EXT_blend_minmax;EXT_color_buffer_half_float;EXT_float_blend;EXT_frag_depth;EXT_shader_texture_lod;EXT_texture_filter_anisotropic;EXT_sRGB;OES_element_index_uint;OES_fbo_render_mipmap;OES_standard_derivatives;OES_texture_float;OES_texture_float_linear;OES_texture_half_float;OES_texture_half_float_linear;OES_vertex_array_object;WEBGL_color_buffer_float;WEBGL_compressed_texture_astc;WEBGL_compressed_texture_etc;WEBGL_compressed_texture_etc1;WEBGL_compressed_texture_pvrtc;WEBGL_debug_renderer_info;WEBGL_debug_shaders;WEBGL_depth_texture;WEBGL_draw_buffers;WEBGL_lose_context',
        webgl_extensions_hash: '58a0e263be8f093e70e8b22f27c60e7f',
        webgl_renderer: 'WebKit WebGL',
        webgl_vendor: 'WebKit',
        webgl_version: 'WebGL 1.0',
        webgl_shading_language_version: 'WebGL GLSL ES 1.0 (1.0)',
        webgl_aliased_line_width_range: '[1, 1]',
        webgl_aliased_point_size_range: '[1, 511]',
        webgl_antialiasing: true,
        webgl_bits: '8,8,24,8,8,0',
        webgl_max_params: '16,32,16384,1024,16384,16,16,30,16,16,4096',
        webgl_max_viewport_dims: '[16384, 16384]',
        webgl_unmasked_vendor: 'Apple Inc.',
        webgl_unmasked_renderer: 'Apple GPU',
        webgl_vsf_params: '23,127,127,23,127,127,23,127,127',
        webgl_vsi_params: '0,31,30,0,31,30,0,31,30',
        webgl_fsf_params: '23,127,127,23,127,127,23,127,127',
        webgl_fsi_params: '0,31,30,0,31,30,0,31,30',
        webgl_hash_webgl: 'b2ea2c52bb0b6c1a20b1c854c3abfc78',
      },
    ],
  },
];

const choice = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
const uniform = (min: number, max: number) => Math.random() * (max - min) + min;

/** get_fp(user_agent) → (checksum, fp_encrypted) */
export function getFp(user_agent: string): { checksum: string; fp: string } {
  const ts = Date.now();
  const gpu = choice(GPUS);
  const [screen_w, screen_h, screen_avail_h, color_depth] = choice(IPHONE_SCREENS);
  const screen_info = `${screen_w}-${screen_h}-${screen_avail_h}-${color_depth}-*-*-*`;

  const bins = Array.from({ length: 256 }, () => randomInt(0, 40));
  bins[0] = randomInt(14473, 16573);
  bins[255] = randomInt(14473, 16573);

  const fp = {
    metrics: {
      fp2: 1, browser: 0, capabilities: 1, gpu: 7, dnt: 0, math: 0, screen: 0,
      navigator: 0, auto: 1, stealth: 0, subtle: 0, canvas: 5, formdetector: 1, be: 0,
    },
    start: ts,
    flashVersion: null,
    plugins: [] as unknown[],
    dupedPlugins: `||${screen_info}`,
    screenInfo: screen_info,
    referrer: '',
    userAgent: user_agent,
    location: '',
    webDriver: false,
    capabilities: {
      css: {
        textShadow: 1, WebkitTextStroke: 1, boxShadow: 1, borderRadius: 1,
        borderImage: 1, opacity: 1, transform: 1, transition: 1,
      },
      js: {
        audio: true,
        geolocation: choice([true, false]),
        localStorage: 'supported',
        touch: true, video: true, webWorker: true,
      },
      elapsed: 1,
    },
    gpu: {
      vendor: gpu.webgl[0].webgl_unmasked_vendor,
      model: gpu.webgl_unmasked_renderer,
      extensions: gpu.webgl[0].webgl_extensions.split(';'),
    },
    dnt: null,
    math: { tan: '-1.4214488238747245', sin: '0.8178819121159085', cos: '-0.5753861119575491' },
    automation: {
      wd: { properties: { document: [] as unknown[], window: [] as unknown[], navigator: [] as unknown[] } },
      phantom: { properties: { window: [] as unknown[] } },
    },
    stealth: { t1: 0, t2: 0, i: 1, mte: 0, mtd: false },
    crypto: {
      crypto: 1, subtle: 1, encrypt: true, decrypt: true, wrapKey: true, unwrapKey: true,
      sign: true, verify: true, digest: true, deriveBits: true, deriveKey: true,
      getRandomValues: true, randomUUID: true,
    },
    canvas: {
      hash: randomInt(645172295, 735192295),
      emailHash: null,
      histogramBins: bins,
    },
    formDetected: false,
    numForms: 0,
    numFormElements: 0,
    be: { si: false },
    end: ts + 1,
    errors: [] as unknown[],
    version: '2.4.0',
    id: randomUUID(),
  };

  const { checksum, data } = encodeWithCrc(fp);
  const cryptor = new Cryptor();
  return { checksum, fp: cryptor.encrypt(data) };
}

export const _test_uniform = uniform;
