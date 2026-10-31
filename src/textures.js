// Procedural PBR textures, generated at runtime (no image downloads).
import * as THREE from 'three';

// ---------------------------------------------------------------- noise
function hash(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Smooth value noise; optional integer period for seamless tiling. */
function vnoise(x, y, seed = 0, px = 0, py = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  let x0 = ix, x1 = ix + 1, y0 = iy, y1 = iy + 1;
  if (px) { x0 = ((x0 % px) + px) % px; x1 = ((x1 % px) + px) % px; }
  if (py) { y0 = ((y0 % py) + py) % py; y1 = ((y1 % py) + py) % py; }
  const a = hash(x0, y0, seed), b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed), d = hash(x1, y1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x, y, oct = 4, seed = 0, px = 0, py = 0) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x * f, y * f, seed + i * 17, px * f, py * f) * amp;
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Height field (Float32Array, row-major, row 0 = top) → tangent-space normal map canvas. */
function normalCanvasFromHeight(height, w, h, strength, wrap = false) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const at = (x, y) => {
    if (wrap) { x = (x + w) % w; y = (y + h) % h; } else {
      x = x < 0 ? 0 : x >= w ? w - 1 : x; y = y < 0 ? 0 : y >= h ? h - 1 : y;
    }
    return height[y * w + x];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // texture v grows upward (flipY), canvas rows grow downward
      const nx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const ny = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inv = 1 / Math.hypot(nx, ny, 1);
      const i = (y * w + x) * 4;
      img.data[i] = (nx * inv * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function tex(canvas, { srgb = false, repeat = null, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------- walnut + brass
/**
 * Board top: lacquered walnut with an inlaid brass grid.
 * @param {number} cells   number of cells per side
 * @param {number} worldSize  side length of the textured area in world units
 * @param {number} cell    cell size in world units
 */
export function makeBoardTextures(cells, worldSize, cell, res = 1024) {
  const S = res;
  const pxPerUnit = S / worldSize;

  // brass inlay mask (canvas for crisp anti-aliased lines)
  const maskC = makeCanvas(S);
  const mctx = maskC.getContext('2d');
  mctx.fillStyle = '#000'; mctx.fillRect(0, 0, S, S);
  mctx.fillStyle = '#fff';
  const half = (cells * cell) / 2;
  const toPx = (w) => (w + worldSize / 2) * pxPerUnit;
  const lw = Math.max(2, 0.028 * pxPerUnit);
  for (let k = 0; k <= cells; k++) {
    const p = toPx(-half + k * cell);
    mctx.fillRect(p - lw / 2, toPx(-half) - lw / 2, lw, toPx(half) - toPx(-half) + lw);
    mctx.fillRect(toPx(-half) - lw / 2, p - lw / 2, toPx(half) - toPx(-half) + lw, lw);
  }
  // outer double border
  const bo = 0.22 * cell * pxPerUnit;
  const blw = lw * 0.6;
  mctx.lineWidth = blw; mctx.strokeStyle = '#fff';
  mctx.strokeRect(toPx(-half) - bo, toPx(-half) - bo, toPx(half) - toPx(-half) + bo * 2, toPx(half) - toPx(-half) + bo * 2);
  // tiny star points at inner intersections (like a go/othello board)
  const dotR = 0.045 * pxPerUnit;
  if (cells >= 4) {
    const pts = [];
    const q = cells >= 6 ? 2 : 1;
    pts.push([q, q], [cells - q, q], [q, cells - q], [cells - q, cells - q]);
    for (const [a, b] of pts) {
      mctx.beginPath();
      mctx.arc(toPx(-half + a * cell), toPx(-half + b * cell), dotR, 0, Math.PI * 2);
      mctx.fill();
    }
  }
  const mask = mctx.getImageData(0, 0, S, S).data;

  // soft (blurred) mask for groove bevels — separable box blur
  const m0 = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) m0[i] = mask[i * 4] / 255;
  const blur = (src, r) => {
    const tmp = new Float32Array(S * S), out = new Float32Array(S * S);
    const n = r * 2 + 1;
    for (let y = 0; y < S; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += src[y * S + Math.min(S - 1, Math.max(0, x))];
      for (let x = 0; x < S; x++) {
        tmp[y * S + x] = acc / n;
        acc += src[y * S + Math.min(S - 1, x + r + 1)] - src[y * S + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < S; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(S - 1, Math.max(0, y)) * S + x];
      for (let y = 0; y < S; y++) {
        out[y * S + x] = acc / n;
        acc += tmp[Math.min(S - 1, y + r + 1) * S + x] - tmp[Math.max(0, y - r) * S + x];
      }
    }
    return out;
  };
  const soft = blur(m0, Math.max(1, Math.round(S / 512)));

  const colC = makeCanvas(S), ormC = makeCanvas(S);
  const colI = colC.getContext('2d').createImageData(S, S);
  const ormI = ormC.getContext('2d').createImageData(S, S);
  const height = new Float32Array(S * S);

  const dark = [38, 22, 13], mid = [74, 45, 27], light = [112, 72, 43];
  const brass = [196, 152, 84];
  const seed = 7;

  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      // grain runs along u; rings vary across v with organic warping
      // quarter-sawn walnut: long, mostly straight grain with gentle drift
      const warp = fbm(u * 1.3, v * 2.6, 4, seed) * 1.0 + fbm(u * 5.0 + 3.1, v * 0.9, 3, seed + 3) * 0.22;
      // irregular ring spacing: warp v by a slow 1D noise so bands bunch and spread
      const vv = v + (fbm(0.37, v * 3.2, 3, seed + 5) - 0.5) * 0.16 + (fbm(u * 0.5, v * 9, 2, seed + 6) - 0.5) * 0.03;
      const t = vv * 27 + warp * 1.25;
      let ring = t - Math.floor(t);
      ring = Math.pow(ring, 2.6); // sharp latewood edge
      const fiber = vnoise(u * 6, v * 700, seed + 9) * 0.55 + vnoise(u * 14, v * 1500, seed + 11) * 0.45;
      const pore = smooth(0.82, 0.95, vnoise(u * 90, v * 1700, seed + 21));
      const big = fbm(u * 1.1 + 9, v * 2.2, 3, seed + 31);

      let k = 0.16 + ring * 0.42 + (fiber - 0.5) * 0.36 + (big - 0.5) * 0.5;
      k = clamp01(k);
      let r, g, b;
      if (k < 0.5) {
        const a = k / 0.5;
        r = dark[0] + (mid[0] - dark[0]) * a; g = dark[1] + (mid[1] - dark[1]) * a; b = dark[2] + (mid[2] - dark[2]) * a;
      } else {
        const a = (k - 0.5) / 0.5;
        r = mid[0] + (light[0] - mid[0]) * a; g = mid[1] + (light[1] - mid[1]) * a; b = mid[2] + (light[2] - mid[2]) * a;
      }
      r *= 1 - pore * 0.45; g *= 1 - pore * 0.5; b *= 1 - pore * 0.5;

      const i = y * S + x;
      const mk = mask[i * 4] / 255;
      const brassVar = 0.9 + vnoise(u * 300, v * 300, 5) * 0.2;
      r = r * (1 - mk) + brass[0] * brassVar * mk;
      g = g * (1 - mk) + brass[1] * brassVar * mk;
      b = b * (1 - mk) + brass[2] * brassVar * mk;

      const p = i * 4;
      colI.data[p] = r; colI.data[p + 1] = g; colI.data[p + 2] = b; colI.data[p + 3] = 255;
      const rough = (0.42 + fiber * 0.12 + pore * 0.25) * (1 - mk) + (0.46 + vnoise(u * 200, v * 200, 3) * 0.12) * mk;
      ormI.data[p] = 255; // AO unused
      ormI.data[p + 1] = clamp01(rough) * 255;
      ormI.data[p + 2] = mk * 0.92 * 255;
      ormI.data[p + 3] = 255;

      height[i] = (fiber - 0.5) * 0.25 - pore * 0.6 + ring * 0.15 - soft[i] * 1.8 + mk * 0.9;
    }
  }
  colC.getContext('2d').putImageData(colI, 0, 0);
  ormC.getContext('2d').putImageData(ormI, 0, 0);
  const nrmC = normalCanvasFromHeight(height, S, S, 1.6);

  return {
    map: tex(colC, { srgb: true }),
    orm: tex(ormC),
    normal: tex(nrmC),
  };
}

/** Tileable walnut for the board's sides/bevels. */
export function makeWoodSideTextures(res = 512) {
  const S = res;
  const colC = makeCanvas(S), colI = colC.getContext('2d').createImageData(S, S);
  const height = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const warp = fbm(u * 4, v * 4, 3, 41, 4, 4) * 1.4;
      const t = v * 6 + warp;
      const ring = Math.pow(t - Math.floor(t), 2.2);
      const fiber = vnoise(u * 8, v * 256, 43, 8, 256);
      let k = clamp01(0.25 + ring * 0.5 + (fiber - 0.5) * 0.3);
      const i = y * S + x, p = i * 4;
      colI.data[p] = 40 + k * 64; colI.data[p + 1] = 24 + k * 40; colI.data[p + 2] = 14 + k * 24; colI.data[p + 3] = 255;
      height[i] = fiber * 0.3 + ring * 0.2;
    }
  }
  colC.getContext('2d').putImageData(colI, 0, 0);
  return {
    map: tex(colC, { srgb: true, repeat: [1, 1] }),
    normal: tex(normalCanvasFromHeight(height, S, S, 1.2, true), { repeat: [1, 1] }),
  };
}

// ---------------------------------------------------------------- table
/** Dark woven linen tablecloth, tileable. */
export function makeTableTextures(res = 512) {
  const S = res;
  const colC = makeCanvas(S), colI = colC.getContext('2d').createImageData(S, S);
  const height = new Float32Array(S * S);
  const threads = 96; // weave count per tile
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const wu = u * threads, wv = v * threads;
      const cu = wu - Math.floor(wu), cv = wv - Math.floor(wv);
      const over = (Math.floor(wu) + Math.floor(wv)) & 1;
      const warpTh = Math.sin(cu * Math.PI), weftTh = Math.sin(cv * Math.PI);
      const slub = vnoise(u * 24, v * 3, 51, 24, 3) * 0.5 + vnoise(u * 3, v * 24, 53, 3, 24) * 0.5;
      const h = over ? warpTh * 0.8 + weftTh * 0.2 : weftTh * 0.8 + warpTh * 0.2;
      const blot = fbm(u * 4, v * 4, 4, 57, 4, 4);
      const k = 0.55 + h * 0.25 + (slub - 0.5) * 0.35 + (blot - 0.5) * 0.25;
      const i = y * S + x, p = i * 4;
      colI.data[p] = 30 * k; colI.data[p + 1] = 33 * k; colI.data[p + 2] = 36 * k; colI.data[p + 3] = 255;
      height[i] = h * 0.6 + slub * 0.4;
    }
  }
  colC.getContext('2d').putImageData(colI, 0, 0);
  return {
    map: tex(colC, { srgb: true, repeat: [1, 1] }),
    normal: tex(normalCanvasFromHeight(height, S, S, 2.4, true), { repeat: [1, 1] }),
  };
}

// ---------------------------------------------------------------- metal
/** Lathe-turned micro-grooves: horizontal streaks, used with LatheGeometry UVs. */
export function makeTurnedMetalTextures() {
  const W = 64, H = 512;
  const height = new Float32Array(W * H);
  const roughC = makeCanvas(W, H), rI = roughC.getContext('2d').createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const line = vnoise(0.5, y * 0.9, 61) * 0.6 + vnoise(0.5, y * 3.1, 63) * 0.4;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      height[i] = line + vnoise(x * 0.2, y * 0.05, 65) * 0.1;
      const p = i * 4;
      const rr = 0.28 + line * 0.14;
      rI.data[p] = 255; rI.data[p + 1] = rr * 255; rI.data[p + 2] = 255; rI.data[p + 3] = 255;
    }
  }
  roughC.getContext('2d').putImageData(rI, 0, 0);
  return {
    normal: tex(normalCanvasFromHeight(height, W, H, 0.9, true), { repeat: [1, 6] }),
    orm: tex(roughC, { repeat: [1, 6] }),
  };
}

/** Radial glow used as the gems' emissive map (fake sub-surface depth) — planar UVs. */
export function makeGemGlowTexture() {
  const S = 256;
  const c = makeCanvas(S), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S * 0.46, S * 0.44, 0, S * 0.5, S * 0.5, S * 0.5);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.5, '#9a9a9a');
  g.addColorStop(1, '#262626');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return tex(c, { srgb: true });
}

/** Draws ▲ ● ■ glyphs (used in the 3D gem textures). */
export function drawGlyph(ctx, kind, cx, cy, r, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  if (kind === 'triangle') {
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
      const px = cx + Math.cos(a) * r * 1.15, py = cy + Math.sin(a) * r * 1.15 + r * 0.12;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  } else if (kind === 'circle') {
    ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
  } else if (kind === 'square') {
    const s = r * 1.45;
    ctx.rect(cx - s / 2, cy - s / 2, s, s);
  }
  ctx.fill();
  ctx.restore();
}

/** Glyph albedo map for the gem: white everywhere, darker engraved glyph. */
export function makeGlyphMap(kind) {
  const S = 256;
  const c = makeCanvas(S), ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S, S);
  drawGlyph(ctx, kind, S / 2, S / 2, S * 0.17, '#3a3a3a');
  return tex(c, { srgb: true });
}

/** Soft round contact shadow. */
export function makeContactShadowTexture() {
  const S = 128;
  const c = makeCanvas(S), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.62, 'rgba(0,0,0,0.6)');
  g.addColorStop(0.8, 'rgba(0,0,0,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return tex(c, { srgb: false });
}

/** Ring sprite for the landing indicator / last-move marker. */
export function makeRingTexture() {
  const S = 256;
  const c = makeCanvas(S), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.30, S / 2, S / 2, S * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.15)');
  g.addColorStop(0.62, 'rgba(255,255,255,1)');
  g.addColorStop(0.78, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return tex(c, { srgb: false });
}

/** Soft square glow for the selected cell. */
export function makeCellGlowTexture() {
  const S = 128;
  const c = makeCanvas(S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = Math.abs(x / (S - 1) * 2 - 1), dy = Math.abs(y / (S - 1) * 2 - 1);
      const d = Math.pow(Math.pow(dx, 6) + Math.pow(dy, 6), 1 / 6);
      const a = smooth(1.0, 0.82, d) * 0.9 + smooth(1.0, 0.0, d) * 0.1;
      const p = (y * S + x) * 4;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = 255;
      img.data[p + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return tex(c);
}
