// "How to play" slides with small isometric SVG illustrations.
const GEM = [
  ['#ff6b7d', '#d4102a', '#5e0410'],
  ['#6dffaa', '#0ea74b', '#03401c'],
  ['#8ab0ff', '#1d55e6', '#071d5c'],
];

const defs = `
<defs>
  ${GEM.map((g, i) => `
  <radialGradient id="hg${i}" cx="45%" cy="40%" r="65%">
    <stop offset="0" stop-color="${g[0]}"/><stop offset=".6" stop-color="${g[1]}"/><stop offset="1" stop-color="${g[2]}"/>
  </radialGradient>`).join('')}
  <linearGradient id="hside" x1="0" x2="1">
    <stop offset="0" stop-color="#2d2f34"/><stop offset=".45" stop-color="#8a8f98"/><stop offset=".7" stop-color="#4a4d54"/><stop offset="1" stop-color="#25272b"/>
  </linearGradient>
  <linearGradient id="hwood" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#5a3a24"/><stop offset="1" stop-color="#3a2416"/>
  </linearGradient>
  <filter id="hglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
</defs>`;

const CH = 22;            // iso cell half-height
const CW = CH * 2;        // iso cell half-width
const T = 9;              // disc thickness (px)

function iso(gx, gy, z, ox, oy) {
  return [ox + (gx - gy) * CW * 0.5, oy + (gx + gy) * CH * 0.5 - z * T];
}

function board(n, ox, oy) {
  const p = (gx, gy) => iso(gx - 0.5, gy - 0.5, 0, ox, oy).join(',');
  let s = `<polygon points="${p(0, 0)} ${p(n, 0)} ${p(n, n)} ${p(0, n)}" fill="url(#hwood)" stroke="#c49854" stroke-width="1"/>`;
  const [ax, ay] = iso(n - 0.5, n - 0.5, 0, ox, oy);
  const [bx, by] = iso(-0.5, n - 0.5, 0, ox, oy);
  const [cx, cy] = iso(n - 0.5, -0.5, 0, ox, oy);
  s += `<polygon points="${bx},${by} ${ax},${ay} ${ax},${ay + 10} ${bx},${by + 10}" fill="#2c1b10"/>`;
  s += `<polygon points="${ax},${ay} ${cx},${cy} ${cx},${cy + 10} ${ax},${ay + 10}" fill="#22150c"/>`;
  for (let k = 1; k < n; k++) {
    s += `<line x1="${iso(k - 0.5, -0.5, 0, ox, oy).join('" y1="')}" x2="${iso(k - 0.5, n - 0.5, 0, ox, oy).join('" y2="')}" stroke="#c49854" stroke-width=".8" opacity=".8"/>`;
    s += `<line x1="${iso(-0.5, k - 0.5, 0, ox, oy).join('" y1="')}" x2="${iso(n - 0.5, k - 0.5, 0, ox, oy).join('" y2="')}" stroke="#c49854" stroke-width=".8" opacity=".8"/>`;
  }
  return s;
}

function disc(x, y, color, { r = 17, ghost = false, glow = false } = {}) {
  const ry = r * 0.5;
  const op = ghost ? ' opacity=".55"' : '';
  let s = `<g${op}>`;
  if (glow) s += `<ellipse cx="${x}" cy="${y + T / 2}" rx="${r + 6}" ry="${ry + 6}" fill="${GEM[color][1]}" filter="url(#hglow)" opacity=".9"/>`;
  s += `<path d="M${x - r},${y} L${x - r},${y + T} A${r},${ry} 0 0 0 ${x + r},${y + T} L${x + r},${y} Z" fill="url(#hside)"/>`;
  s += `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${ry}" fill="#6a6e76"/>`;
  if (color >= 0) s += `<ellipse cx="${x}" cy="${y}" rx="${r * 0.74}" ry="${ry * 0.74}" fill="url(#hg${color})"/>`;
  s += `<ellipse cx="${x - r * 0.25}" cy="${y - ry * 0.3}" rx="${r * 0.22}" ry="${ry * 0.16}" fill="#fff" opacity=".45"/>`;
  s += '</g>';
  return s;
}

function stack(gx, gy, colors, ox, oy, { gap = 0, glowAt = -1 } = {}) {
  return colors.map((c, z) => {
    const [x, y] = iso(gx, gy, z, ox, oy);
    return disc(x, y - z * gap, c, { glow: z === glowAt });
  }).join('');
}

function chip(x, y, c, on) {
  return `<g>
    ${on ? `<circle cx="${x}" cy="${y}" r="17" fill="none" stroke="${GEM[c][0]}" stroke-width="2" opacity=".9"/>` : ''}
    <circle cx="${x}" cy="${y}" r="12" fill="url(#hg${c})" stroke="#55585f" stroke-width="2.5"/>
    <circle cx="${x - 4}" cy="${y - 4}" r="3" fill="#fff" opacity=".6"/>
  </g>`;
}

const svg = (inner) => `<svg viewBox="0 0 320 190" xmlns="http://www.w3.org/2000/svg">${defs}${inner}</svg>`;

function art1() {
  const ox = 190, oy = 62;
  let s = board(3, ox, oy);
  s += stack(0, 2, [0], ox, oy) + stack(2, 0, [2], ox, oy) + stack(2, 2, [1], ox, oy);
  const [gx, gy] = iso(1, 1, 0, ox, oy);
  s += `<ellipse cx="${gx}" cy="${gy}" rx="22" ry="11" fill="none" stroke="#fff" stroke-width="1.5" opacity=".8"/>`;
  s += disc(gx, gy - 34, 1, { ghost: true });
  s += `<line x1="${gx}" y1="${gy - 22}" x2="${gx}" y2="${gy - 6}" stroke="#fff" stroke-dasharray="2 3" opacity=".6"/>`;
  s += chip(42, 70, 0, false) + chip(42, 108, 1, true) + chip(42, 146, 2, false);
  s += `<path d="M66 108 C 100 108, 120 ${gy - 34}, ${gx - 26} ${gy - 34}" fill="none" stroke="#fff" stroke-width="1.5" stroke-dasharray="3 4" opacity=".5"/>`;
  return svg(s);
}

function art2() {
  const ox = 160, oy = 70;
  let s = board(3, ox, oy);
  s += stack(1, 1, [2, 0, 1], ox, oy);
  s += stack(0, 0, [0], ox, oy) + stack(2, 1, [1, 2], ox, oy);
  const [x, y] = iso(1, 1, 3, ox, oy);
  s += disc(x, y - 38, 2, { ghost: true });
  s += `<path d="M${x} ${y - 24} v14" stroke="#fff" stroke-width="2" opacity=".7"/><path d="M${x - 5} ${y - 15} l5 6 l5 -6" fill="none" stroke="#fff" stroke-width="2" opacity=".7"/>`;
  return svg(s);
}

function art3() {
  // left: what is really there (side, exploded). right: what you see (top-down).
  let s = '';
  const lx = 78, ly = 120;
  const cols = [[2, 0, 1], [0, 2], [1]];
  cols.forEach((c, i) => {
    c.forEach((color, z) => { s += disc(lx - 40 + i * 40, ly - z * 26, color, { r: 15 }); });
  });
  s += `<text x="${lx}" y="172" fill="#fff" opacity=".55" font-size="11" text-anchor="middle" font-family="sans-serif" letter-spacing="2">ほんとうは</text>`;
  s += `<path d="M150 95 h22" stroke="#fff" stroke-width="2" opacity=".5"/><path d="M168 89 l6 6 l-6 6" fill="none" stroke="#fff" stroke-width="2" opacity=".5"/>`;
  const rx = 245, ry = 95, cs = 34;
  s += `<rect x="${rx - cs * 1.5}" y="${ry - cs * 1.5}" width="${cs * 3}" height="${cs * 3}" rx="6" fill="url(#hwood)" stroke="#c49854"/>`;
  for (let k = 1; k < 3; k++) {
    s += `<line x1="${rx - cs * 1.5 + k * cs}" y1="${ry - cs * 1.5}" x2="${rx - cs * 1.5 + k * cs}" y2="${ry + cs * 1.5}" stroke="#c49854" stroke-width=".8"/>`;
    s += `<line x1="${rx - cs * 1.5}" y1="${ry - cs * 1.5 + k * cs}" x2="${rx + cs * 1.5}" y2="${ry - cs * 1.5 + k * cs}" stroke="#c49854" stroke-width=".8"/>`;
  }
  const tops = [1, 2, 1];
  tops.forEach((c, i) => {
    const x = rx - cs + i * cs, y = ry;
    s += `<circle cx="${x}" cy="${y}" r="14" fill="#6a6e76"/><circle cx="${x}" cy="${y}" r="10.5" fill="url(#hg${c})"/>`;
    const h = cols[i].length;
    s += `<circle cx="${x + 10}" cy="${y + 10}" r="6" fill="#0b0c0f" opacity=".75"/><text x="${x + 10}" y="${y + 13}" fill="#fff" font-size="8" text-anchor="middle" font-family="sans-serif" font-weight="700">${h}</text>`;
    if (h > 1) s += `<text x="${x}" y="${y - 20}" fill="#fff" opacity=".7" font-size="12" text-anchor="middle" font-family="sans-serif">?</text>`;
  });
  s += `<text x="${rx}" y="172" fill="#fff" opacity=".55" font-size="11" text-anchor="middle" font-family="sans-serif" letter-spacing="2">見えるのは上だけ</text>`;
  return svg(s);
}

function art4() {
  const ox = 112, oy = 38;
  let s = board(4, ox, oy);
  // staircase of blue along x on row y=2 — lower ones hidden under other colors
  const rows = [[2, 0], [1, 2, 1], [0, 1, 2], [1, 0, 0, 2]];
  rows.forEach((c, i) => { s += stack(i, 1.5, c, ox, oy, { gap: 7, glowAt: c.lastIndexOf(2) }); });
  const pts = [[0, 0], [1, 1], [2, 2], [3, 3]].map(([gx, z]) => {
    const [x, y] = iso(gx, 1.5, z, ox, oy);
    return `${x},${y - z * 7}`;
  });
  s += `<polyline points="${pts.join(' ')}" fill="none" stroke="#9cc0ff" stroke-width="2.5" opacity=".95" stroke-linecap="round"/>`;
  return svg(s);
}

export const SLIDES = [
  {
    art: art1,
    title: '色を選んで、マスに置く',
    body: '赤・緑・青のコマは<b>2人の共有</b>。自分の番に好きな色を選び、マスをタップ。<b>もう一度タップ</b>（または［置く］）で確定します。',
  },
  {
    art: art2,
    title: '同じマスに積み重なる',
    body: 'コマのあるマスには、その上に積めます。高さには上限があり、満杯のマスには置けません。',
  },
  {
    art: art3,
    title: '真上からは、一番上しか見えない',
    body: 'カメラは盤を真上から見下ろしています。<b>下に隠れたコマの色は見えません。</b>何をどこに置いたか、覚えておきましょう。右下の数字は段数です。',
  },
  {
    art: art4,
    title: '同じ色を4つ並べたら勝ち',
    body: '縦・横・ななめ・積み上げ、<b>階段状</b>や立体ななめもOK。誰が置いたコマでも<b>4つ目を置いた人の勝ち</b>。相手にリーチを渡さない色選びが鍵です。',
  },
];
