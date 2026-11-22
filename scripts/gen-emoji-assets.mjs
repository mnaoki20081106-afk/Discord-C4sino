// 全絵文字アセットの PNG を assets/ 配下に書き出す。
// 構成:
//   assets/cards/card_<suit>_<rank>.png  (52) + card_back.png (1)
//   assets/slots/slot_<name>.png           (8)
//   assets/roulette/rl_<n>.png             (37)
//   assets/dice/dice_<n>.png               (6)
//
// すべて PNG、各 128px 短辺目安、Discord Application Emoji の 256KB 制限内。
//
// 実行: node scripts/gen-emoji-assets.mjs  (or: npx tsx)

import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = 'assets';

function save(path, buf) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function seededRng(s) { let x = s|0||1; return () => { x = (x*1664525+1013904223)|0; return ((x>>>0)%100000)/100000; }; }

// ========================================================================
// 1) トランプ 52 枚 + 裏 1 枚
// ========================================================================
// Discord Application Emoji は 128×128 以内。縦長カードは高さ 128 に合わせる。
const CARD_W = 92, CARD_H = 128, CARD_R = 11;
const SUITS = ['S', 'H', 'D', 'C'];
const SUIT_NAME = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SUIT_COLOR = { S: '#1a1a1a', H: '#b91c1c', D: '#b91c1c', C: '#1a1a1a' };
const RANKS = ['A', 2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K'];
const RANK_NAME = (r) => r === 'A' ? 'a' : r === 'J' ? 'j' : r === 'Q' ? 'q' : r === 'K' ? 'k' : String(r);

function drawTrumpFace(ctx, x, y, card) {
  const col = SUIT_COLOR[card.suit];
  const sym = SUIT_GLYPH[card.suit];
  const rank = card.rank === 10 ? '10' : String(card.rank);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 7; ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, x, y, CARD_W, CARD_H, CARD_R); ctx.fill();
  ctx.restore();

  ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1.5;
  roundRect(ctx, x + 1, y + 1, CARD_W - 2, CARD_H - 2, CARD_R - 1); ctx.stroke();

  ctx.fillStyle = col;
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  const rankFont = rank === '10' ? 32 : 40;
  ctx.font = `600 ${rankFont}px sans-serif`;
  ctx.fillText(rank, x + 6, y + 4);

  ctx.save();
  ctx.translate(x + CARD_W - 6, y + CARD_H - 4);
  ctx.rotate(Math.PI);
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  ctx.font = `600 ${rankFont}px sans-serif`;
  ctx.fillText(rank, 0, 0);
  ctx.restore();

  ctx.font = `bold 50px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(sym, x + CARD_W / 2, y + CARD_H / 2 + 3);
}

function makeTrumpFace(suit, rank) {
  const c = createCanvas(CARD_W, CARD_H);
  const ctx = c.getContext('2d');
  drawTrumpFace(ctx, 0, 0, { suit, rank });
  return c;
}

// 裏 (v4 デザイン、2x スケール)
function drawBigStar(ctx, cx, cy, size, alpha = 1) {
  ctx.save();
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.beginPath(); ctx.arc(cx, cy, size * 0.55, 0, Math.PI*2); ctx.fill();
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 4);
  g.addColorStop(0, `rgba(255,255,255,${alpha * 0.9})`);
  g.addColorStop(0.3, `rgba(255,255,255,0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, size * 4, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
  ctx.lineWidth = size * 0.3; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - size * 3.2, cy); ctx.lineTo(cx + size * 3.2, cy);
  ctx.moveTo(cx, cy - size * 3.2); ctx.lineTo(cx, cy + size * 3.2);
  ctx.stroke();
  ctx.lineWidth = size * 0.12;
  ctx.beginPath();
  ctx.moveTo(cx - size * 1.6, cy - size * 1.6); ctx.lineTo(cx + size * 1.6, cy + size * 1.6);
  ctx.moveTo(cx + size * 1.6, cy - size * 1.6); ctx.lineTo(cx - size * 1.6, cy + size * 1.6);
  ctx.stroke();
  ctx.restore();
}
function drawCenterEmblem(ctx, cx, cy, size) {
  ctx.save();
  ctx.fillStyle = '#eef0f5';
  const outer = (s) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy - s);
    ctx.quadraticCurveTo(cx + s * 0.3, cy - s * 0.3, cx + s, cy);
    ctx.quadraticCurveTo(cx + s * 0.3, cy + s * 0.3, cx, cy + s);
    ctx.quadraticCurveTo(cx - s * 0.3, cy + s * 0.3, cx - s, cy);
    ctx.quadraticCurveTo(cx - s * 0.3, cy - s * 0.3, cx, cy - s);
    ctx.closePath(); ctx.fill();
  };
  outer(size);
  ctx.globalCompositeOperation = 'destination-out';
  outer(size * 0.5);
  ctx.restore();
  ctx.fillStyle = '#eef0f5';
  const inner = size * 0.18;
  ctx.beginPath();
  ctx.moveTo(cx, cy - inner); ctx.lineTo(cx + inner, cy); ctx.lineTo(cx, cy + inner); ctx.lineTo(cx - inner, cy);
  ctx.closePath(); ctx.fill();
}
function drawEdgeDiamond(ctx, cx, cy, s) {
  ctx.fillStyle = '#eef0f5';
  ctx.beginPath();
  ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s, cy); ctx.lineTo(cx, cy + s); ctx.lineTo(cx - s, cy);
  ctx.closePath(); ctx.fill();
}
function drawTrumpBack(ctx, x, y, seed) {
  const SCALE = 0.82;   // 128h 向けに縮小
  const rng = seededRng(seed);
  ctx.fillStyle = '#000';
  roundRect(ctx, x, y, CARD_W, CARD_H, CARD_R); ctx.fill();
  const PAD = 8 * SCALE;
  const ix = x + PAD, iy = y + PAD, iw = CARD_W - PAD * 2, ih = CARD_H - PAD * 2;
  ctx.save();
  roundRect(ctx, ix, iy, iw, ih, CARD_R - 4 * SCALE); ctx.clip();
  ctx.fillStyle = '#000'; ctx.fillRect(ix, iy, iw, ih);
  const bandAngle = -Math.PI * 0.32;
  const bandCos = Math.cos(bandAngle), bandSin = Math.sin(bandAngle);
  const bandCenter = { x: ix + iw / 2, y: iy + ih / 2 };
  const paintBand = (c0, c1, a, r) => {
    const g = ctx.createLinearGradient(
      bandCenter.x - bandCos * r, bandCenter.y - bandSin * r,
      bandCenter.x + bandCos * r, bandCenter.y + bandSin * r);
    g.addColorStop(0, `rgba(${c0},0)`);
    g.addColorStop(0.5, `rgba(${c1},${a})`);
    g.addColorStop(1, `rgba(${c0},0)`);
    ctx.fillStyle = g; ctx.fillRect(ix, iy, iw, ih);
  };
  paintBand('5,10,40', '18,30,85', 0.42, iw * 0.95);
  paintBand('10,25,70', '28,65,170', 0.3, iw * 0.65);
  paintBand('20,10,50', '85,50,180', 0.18, iw * 0.4);
  paintBand('5,10,35', '35,80,200', 0.14, iw * 0.25);
  for (let i = 0; i < 14; i++) {
    const t = rng() * 2 - 1;
    const sx = bandCenter.x + bandCos * iw * 0.42 * t + (rng() - 0.5) * 24 * SCALE;
    const sy = bandCenter.y + bandSin * iw * 0.42 * t + (rng() - 0.5) * 18 * SCALE;
    const r = (2 + rng() * 4) * SCALE;
    const col = Math.abs(t) < 0.4 ? [140,100,220] : [100,130,220];
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    g.addColorStop(0, `rgba(${col.join(',')}, 0.4)`);
    g.addColorStop(1, `rgba(${col.join(',')}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI*2); ctx.fill();
  }
  for (let i = 0; i < 220; i++) {
    const sx = ix + rng() * iw, sy = iy + rng() * ih;
    const r = (rng() * 0.7 + 0.2) * SCALE;
    const a = rng() * 0.45 + 0.25;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI*2); ctx.fill();
  }
  for (const [bx, by, bs, ba] of [
    [ix + iw * 0.18, iy + ih * 0.15, 2.0 * SCALE, 0.95],
    [ix + iw * 0.82, iy + ih * 0.25, 1.6 * SCALE, 0.85],
    [ix + iw * 0.35, iy + ih * 0.42, 1.2 * SCALE, 0.7],
    [ix + iw * 0.72, iy + ih * 0.62, 1.8 * SCALE, 0.95],
    [ix + iw * 0.22, iy + ih * 0.78, 1.4 * SCALE, 0.75],
    [ix + iw * 0.88, iy + ih * 0.88, 1.2 * SCALE, 0.7],
  ]) drawBigStar(ctx, bx, by, bs, ba);
  ctx.restore();
  const FS = 4 * SCALE;
  const fx = x + FS, fy = y + FS, fw = CARD_W - FS * 2, fh = CARD_H - FS * 2;
  ctx.strokeStyle = 'rgba(238, 240, 245, 0.85)';
  ctx.lineWidth = 1.2 * SCALE;
  roundRect(ctx, fx, fy, fw, fh, CARD_R - 2 * SCALE); ctx.stroke();
  ctx.lineWidth = 0.6 * SCALE;
  roundRect(ctx, fx + 3 * SCALE, fy + 3 * SCALE, fw - 6 * SCALE, fh - 6 * SCALE, CARD_R - 4 * SCALE); ctx.stroke();
  drawEdgeDiamond(ctx, x + CARD_W / 2, fy, 2.5 * SCALE);
  drawEdgeDiamond(ctx, x + CARD_W / 2, fy + fh, 2.5 * SCALE);
  drawEdgeDiamond(ctx, fx, y + CARD_H / 2, 2.5 * SCALE);
  drawEdgeDiamond(ctx, fx + fw, y + CARD_H / 2, 2.5 * SCALE);
  drawCenterEmblem(ctx, x + CARD_W / 2, y + CARD_H / 2, 14 * SCALE);
}

// 出力: cards
let n = 0;
for (const s of SUITS) {
  for (const r of RANKS) {
    const c = makeTrumpFace(s, r);
    const buf = await c.encode('png');
    save(`${OUT}/cards/card_${SUIT_NAME[s]}_${RANK_NAME(r)}.png`, buf);
    n++;
  }
}
{
  const c = createCanvas(CARD_W, CARD_H);
  drawTrumpBack(c.getContext('2d'), 0, 0, 42);
  const buf = await c.encode('png');
  save(`${OUT}/cards/card_back.png`, buf);
  n++;
}
console.log(`cards: ${n}`);

// ========================================================================
// 2) スロットシンボル 8 (128×128)
// ========================================================================
const SZ = 128;
function slotBase(ctx, tint) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
  const g = ctx.createRadialGradient(SZ/2 - 15, SZ/2 - 20, 6, SZ/2, SZ/2, 60);
  g.addColorStop(0, '#3f3f46'); g.addColorStop(1, tint ?? '#18181b');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(SZ/2, SZ/2, 58, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(SZ/2, SZ/2, 58, 0, Math.PI * 2); ctx.stroke();
}
function slotCanvas(draw, tint) {
  const c = createCanvas(SZ, SZ);
  const ctx = c.getContext('2d');
  slotBase(ctx, tint);
  draw(ctx, SZ/2, SZ/2);
  return c;
}
function drawCherry(ctx, cx, cy) {
  ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx - 12, cy - 26); ctx.quadraticCurveTo(cx, cy - 38, cx + 12, cy - 26); ctx.stroke();
  ctx.fillStyle = '#16a34a';
  ctx.beginPath(); ctx.ellipse(cx + 3, cy - 32, 10, 4, Math.PI/6, 0, Math.PI*2); ctx.fill();
  const berry = (bx, by) => {
    const g = ctx.createRadialGradient(bx-5, by-5, 2, bx, by, 15);
    g.addColorStop(0, '#fca5a5'); g.addColorStop(0.4, '#dc2626'); g.addColorStop(1, '#7f1d1d');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(bx, by, 16, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath(); ctx.arc(bx-4, by-4, 3, 0, Math.PI*2); ctx.fill();
  };
  berry(cx - 12, cy - 8); berry(cx + 15, cy + 2);
}
function drawLemon(ctx, cx, cy) {
  const g = ctx.createRadialGradient(cx-8, cy-8, 3, cx, cy, 28);
  g.addColorStop(0, '#fef08a'); g.addColorStop(0.6, '#facc15'); g.addColorStop(1, '#a16207');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(cx, cy, 28, 22, Math.PI/12, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#854d0e';
  ctx.beginPath(); ctx.arc(cx-26, cy-3, 3, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx+26, cy+3, 3, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath(); ctx.ellipse(cx-9, cy-9, 5, 3, 0, 0, Math.PI*2); ctx.fill();
}
function drawOrange(ctx, cx, cy) {
  const g = ctx.createRadialGradient(cx-7, cy-7, 3, cx, cy, 28);
  g.addColorStop(0, '#fed7aa'); g.addColorStop(0.5, '#f97316'); g.addColorStop(1, '#9a3412');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, 26, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#16a34a';
  ctx.beginPath(); ctx.ellipse(cx+5, cy-26, 8, 4, -0.4, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath(); ctx.arc(cx-8, cy-8, 4, 0, Math.PI*2); ctx.fill();
}
function drawMelon(ctx, cx, cy) {
  ctx.fillStyle = '#166534';
  ctx.beginPath(); ctx.arc(cx, cy, 32, 0, Math.PI); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#dc2626';
  ctx.beginPath(); ctx.arc(cx, cy, 26, 0, Math.PI); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#111';
  for (const [dx, dy] of [[-14, 6], [-6, 14], [6, 14], [14, 6], [0, 20]]) {
    ctx.beginPath(); ctx.arc(cx + dx, cy + dy, 2.2, 0, Math.PI*2); ctx.fill();
  }
}
function drawStar(ctx, cx, cy) {
  const g = ctx.createLinearGradient(cx, cy - 30, cx, cy + 30);
  g.addColorStop(0, '#fde68a'); g.addColorStop(1, '#ca8a04');
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 32 : 14;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2; ctx.stroke();
}
function drawBell(ctx, cx, cy) {
  const g = ctx.createLinearGradient(cx, cy - 30, cx, cy + 30);
  g.addColorStop(0, '#fde68a'); g.addColorStop(0.4, '#eab308'); g.addColorStop(1, '#854d0e');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(cx - 24, cy + 12);
  ctx.quadraticCurveTo(cx - 30, cy - 24, cx, cy - 30);
  ctx.quadraticCurveTo(cx + 30, cy - 24, cx + 24, cy + 12);
  ctx.closePath(); ctx.fill();
  ctx.fillRect(cx - 30, cy + 12, 60, 7);
  ctx.fillStyle = '#92400e';
  ctx.beginPath(); ctx.arc(cx, cy + 26, 6, 0, Math.PI*2); ctx.fill();
}
function drawDiamond(ctx, cx, cy) {
  const g = ctx.createLinearGradient(cx, cy - 30, cx, cy + 30);
  g.addColorStop(0, '#bae6fd'); g.addColorStop(0.5, '#22d3ee'); g.addColorStop(1, '#0e7490');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 30); ctx.lineTo(cx + 26, cy - 6); ctx.lineTo(cx + 18, cy + 28);
  ctx.lineTo(cx - 18, cy + 28); ctx.lineTo(cx - 26, cy - 6); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 26, cy - 6); ctx.lineTo(cx + 26, cy - 6);
  ctx.moveTo(cx, cy - 30); ctx.lineTo(cx, cy + 28);
  ctx.stroke();
}
function drawSeven(ctx, cx, cy) {
  const g = ctx.createLinearGradient(cx, cy - 36, cx, cy + 30);
  g.addColorStop(0, '#fecaca'); g.addColorStop(0.5, '#dc2626'); g.addColorStop(1, '#7f1d1d');
  ctx.fillStyle = g;
  ctx.font = 'bold 80px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('7', cx, cy + 4);
  ctx.strokeStyle = '#fde68a'; ctx.lineWidth = 2.5;
  ctx.strokeText('7', cx, cy + 4);
}

const SLOT_SET = [
  { name: 'cherry',  fn: drawCherry  },
  { name: 'lemon',   fn: drawLemon   },
  { name: 'orange',  fn: drawOrange  },
  { name: 'melon',   fn: drawMelon   },
  { name: 'star',    fn: drawStar    },
  { name: 'bell',    fn: drawBell    },
  { name: 'diamond', fn: drawDiamond },
  { name: 'seven',   fn: drawSeven, tint: '#450a0a' },
];
for (const s of SLOT_SET) {
  const c = slotCanvas(s.fn, s.tint);
  const buf = await c.encode('png');
  save(`${OUT}/slots/slot_${s.name}.png`, buf);
}
console.log(`slots: ${SLOT_SET.length}`);

// ========================================================================
// 3) ルーレット数字チップ 0..36 (128×128)
// ========================================================================
const RED_SET = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
function rColor(n) { return n === 0 ? 'green' : (RED_SET.has(n) ? 'red' : 'black'); }
function drawChip(ctx, n) {
  const color = rColor(n);
  const fills = {
    red:   { outer: '#dc2626', inner: '#ef4444' },
    black: { outer: '#111111', inner: '#1f2937' },
    green: { outer: '#166534', inner: '#16a34a' },
  }[color];
  const cx = SZ/2, cy = SZ/2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
  ctx.fillStyle = fills.outer;
  ctx.beginPath(); ctx.arc(cx, cy, 58, 0, Math.PI*2); ctx.fill();
  ctx.restore();
  const g = ctx.createRadialGradient(cx-8, cy-8, 6, cx, cy, 50);
  g.addColorStop(0, fills.inner); g.addColorStop(1, fills.outer);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, 46, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 52, cy + Math.sin(a) * 52);
    ctx.lineTo(cx + Math.cos(a) * 58, cy + Math.sin(a) * 58);
    ctx.stroke();
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${n >= 10 ? 40 : 52}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(n), cx, cy + 3);
}
for (let n = 0; n <= 36; n++) {
  const c = createCanvas(SZ, SZ);
  drawChip(c.getContext('2d'), n);
  const buf = await c.encode('png');
  save(`${OUT}/roulette/rl_${n}.png`, buf);
}
console.log(`roulette: 37`);

// ========================================================================
// 4) ダイス 6 面 (128×128)
// ========================================================================
function drawDice(ctx, n) {
  const cx = SZ/2, cy = SZ/2;
  const s = 96;
  const l = cx - s/2, t = cy - s/2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
  const g = ctx.createLinearGradient(l, t, l, t + s);
  g.addColorStop(0, '#fffbeb'); g.addColorStop(1, '#e5e7eb');
  ctx.fillStyle = g;
  roundRect(ctx, l, t, s, s, 16); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#c7cbd1'; ctx.lineWidth = 2;
  roundRect(ctx, l, t, s, s, 16); ctx.stroke();
  const p = 22;
  const spots = {
    1: [[0,0]],
    2: [[-p,-p],[p,p]],
    3: [[-p,-p],[0,0],[p,p]],
    4: [[-p,-p],[p,-p],[-p,p],[p,p]],
    5: [[-p,-p],[p,-p],[0,0],[-p,p],[p,p]],
    6: [[-p,-p],[p,-p],[-p,0],[p,0],[-p,p],[p,p]],
  }[n];
  for (const [dx, dy] of spots) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(cx + dx, cy + dy, 8, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }
}
for (let i = 1; i <= 6; i++) {
  const c = createCanvas(SZ, SZ);
  drawDice(c.getContext('2d'), i);
  const buf = await c.encode('png');
  save(`${OUT}/dice/dice_${i}.png`, buf);
}
console.log(`dice: 6`);

console.log('\nAll emoji assets generated under ./assets/');
