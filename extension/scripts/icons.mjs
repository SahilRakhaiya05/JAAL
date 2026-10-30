// Rasterises the JAAL net mark (same geometry as the inline SVG in the pages) to 16/32/48/128 PNGs.
// Pure JS: analytic shapes, 5x5 supersampling, zlib for PNG. Run: node scripts/icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRAND = [0x6e, 0x5b, 0xff];
const C = 16, R = 9;
const NODES = [-90, -30, 30, 90, 150, 210].map((a) => [C + R * Math.cos((a * Math.PI) / 180), C + R * Math.sin((a * Math.PI) / 180)]);
const SEGMENTS = [[NODES[0], NODES[3]], [NODES[5], NODES[2]], [NODES[4], NODES[1]]];

function inRoundRect(x, y, s, rx) {
  if (x < 0 || y < 0 || x > s || y > s) return false;
  const cx = Math.min(Math.max(x, rx), s - rx), cy = Math.min(Math.max(y, rx), s - rx);
  return (x - cx) ** 2 + (y - cy) ** 2 <= rx * rx;
}
function distSeg(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function sample(x, y, size) {
  // Thicken strokes and dots at small sizes so the mark survives 16px.
  const k = Math.max(1, 26 / size);
  const sw = 1.5 * k, dot = 1.9 * Math.min(k, 1.5), hub = 2.8 * Math.min(k, 1.4);
  if (!inRoundRect(x, y, 32, 9)) return [0, 0, 0, 0];
  let white = 0;
  if (Math.abs(Math.hypot(x - C, y - C) - R) <= sw / 2) white = 0.85;
  if (size >= 32) for (const s of SEGMENTS) if (distSeg(x, y, s[0], s[1]) <= sw / 2) white = Math.max(white, 0.85);
  if (Math.hypot(x - C, y - C) <= hub) white = 1;
  for (const [nx, ny] of NODES) if (Math.hypot(x - nx, y - ny) <= dot) white = 1;
  return [BRAND[0] + (255 - BRAND[0]) * white, BRAND[1] + (255 - BRAND[1]) * white, BRAND[2] + (255 - BRAND[2]) * white, 255];
}

export function renderIcon(size) {
  const ss = 5;
  const px = new Uint8Array(size * size * 4);
  const unit = 32 / size;
  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const [cr, cg, cb, ca] = sample((pxl + (sx + 0.5) / ss) * unit, (py + (sy + 0.5) / ss) * unit, size);
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const i = (py * size + pxl) * 4;
      if (a > 0) { px[i] = Math.round(r / a); px[i + 1] = Math.round(g / a); px[i + 2] = Math.round(b / a); }
      px[i + 3] = Math.round(a / (ss * ss));
    }
  }
  return encodePNG(size, size, px);
}

export function writeIcons() {
  const dir = path.join(ROOT, 'icons');
  fs.mkdirSync(dir, { recursive: true });
  for (const s of [16, 32, 48, 128]) fs.writeFileSync(path.join(dir, `icon-${s}.png`), renderIcon(s));
  fs.writeFileSync(path.join(dir, 'mark.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#6E5BFF"/><g stroke="#fff" stroke-width="1.5" fill="none" stroke-opacity=".85"><circle cx="16" cy="16" r="9"/><path d="M16 7v18M8.2 11.5l15.6 9M8.2 20.5l15.6-9"/></g><g fill="#fff"><circle cx="16" cy="16" r="2.8"/>' +
    NODES.map(([x, y]) => `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.9"/>`).join('') + '</g></svg>\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeIcons();
  console.log('icons written');
}
