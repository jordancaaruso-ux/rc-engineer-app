// Regenerates every app/PWA icon PNG from the locked JRC vector mark.
//
// The glyph geometry is read verbatim from `public/brand/jrc-mark-yellow.svg`
// (single path, viewBox 0 0 731 241) so the shape is never redrawn — this
// script only composes the icon: background + mark, each with a subtle gradient
// for depth, mark scaled up to fill the tile.
//
// Founder-approved treatment (2026-07-14, via icon-depth studies artifact):
//   mark size 82% · mark gradient 10 · background "top light" · depth 11
//
// Run:  node scripts/generate-app-icons.mjs
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- locked glyph -----------------------------------------------------------
const markSvg = readFileSync(join(ROOT, "public/brand/jrc-mark-yellow.svg"), "utf8");
const D = markSvg.match(/\bd="([^"]+)"/)[1];
const VB = { w: 731, h: 241 };
const SIZE = 1024; // master canvas

// --- approved knobs ---------------------------------------------------------
const CFG = { scale: 82, mark: 10, bg: "linear", bgInt: 11 };
const MASKABLE_SCALE = 74; // pull mark into the adaptive-icon safe circle

// --- colour helpers (mirror the studies artifact exactly) -------------------
const BASE = [255, 209, 26];      // #FFD11A shipped mark
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const GRAPHITE = [46, 42, 36];    // #2E2A24 depth lift
const hx = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const toHex = (c) => "#" + hx(c[0]) + hx(c[1]) + hx(c[2]);

function iconSvg(scalePct) {
  const scale = (scalePct / 100) * SIZE / VB.w;
  const mw = VB.w * scale, mh = VB.h * scale;
  const tx = (SIZE - mw) / 2, ty = (SIZE - mh) / 2;

  // background — subtle top light fading to black
  const top = toHex(mix(BLACK, GRAPHITE, CFG.bgInt / 100));
  const bgDef = `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${top}"/>
      <stop offset="70%" stop-color="#000000"/>
      <stop offset="100%" stop-color="#000000"/></linearGradient>`;

  // mark — subtle top-lit sheen
  const t = CFG.mark / 100;
  const mTop = toHex(mix(BASE, WHITE, t * 0.9));
  const mBot = toHex(mix(BASE, [180, 120, 0], t * 1.15));
  const mkDef = `<linearGradient id="mk" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${mTop}"/>
      <stop offset="52%" stop-color="#FFD11A"/>
      <stop offset="100%" stop-color="${mBot}"/></linearGradient>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">
    <defs>${bgDef}${mkDef}</defs>
    <rect width="${SIZE}" height="${SIZE}" fill="url(#bg)"/>
    <g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${scale.toFixed(5)})">
      <path d="${D}" fill="url(#mk)" fill-rule="evenodd"/>
    </g></svg>`;
}

const STANDARD = Buffer.from(iconSvg(CFG.scale));
const MASKABLE = Buffer.from(iconSvg(MASKABLE_SCALE));

const targets = [
  { file: "public/icons/icon-1024.png", size: 1024, src: STANDARD },
  { file: "public/icons/icon-512.png", size: 512, src: STANDARD },
  { file: "public/icons/icon-192.png", size: 192, src: STANDARD },
  { file: "public/icons/icon-maskable-512.png", size: 512, src: MASKABLE },
  { file: "src/app/icon.png", size: 512, src: STANDARD },
  { file: "src/app/apple-icon.png", size: 180, src: STANDARD },
];

for (const t of targets) {
  await sharp(t.src, { density: 384 })
    .resize(t.size, t.size)
    .png({ compressionLevel: 9 })
    .toFile(join(ROOT, t.file));
  console.log(`✓ ${t.file}  (${t.size}px)`);
}
console.log("Done — all icons regenerated from the locked mark.");
