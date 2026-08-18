// Regenerates every app/PWA icon PNG from the locked JRC vector mark.
//
// The glyph geometry is read verbatim from `public/brand/jrc-mark-yellow.svg`
// (single path, viewBox 0 0 731 241) so the shape is never redrawn — this
// script only composes the icon.
//
// Founder-approved treatment "2c shaded" (2026-08-18), replacing the older
// yellow-mark-on-black tile:
//   yellow field (radial "lit" gradient, light off the top-left) · black #121110
//   mark · one soft cast shadow under the glyph · mark 88% of the tile.
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
const MARK_PCT = 88;          // glyph width as a % of the tile
// Android masks a maskable icon down to a circle of 80% diameter. A 731x241
// rectangle only fits inside that circle up to ~76% tile width, so the maskable
// variant draws the same art smaller — anything wider gets its J and C clipped.
const MASKABLE_PCT = 72;
const CORNER_PCT = 22.36;     // squircle radius (229/1024) for the rounded variants
const INK = "#121110";

function iconSvg({ markPct = MARK_PCT, rounded = false } = {}) {
  const scale = ((markPct / 100) * SIZE) / VB.w;
  const mw = VB.w * scale;
  const mh = VB.h * scale;
  const tx = (SIZE - mw) / 2;
  const ty = (SIZE - mh) / 2;

  // Shadow was tuned against the 88% glyph; scale it so the smaller maskable
  // variant keeps the same visual weight rather than a heavier one.
  const k = markPct / MARK_PCT;
  const dy = (14.3 * k).toFixed(2);
  const blur = (8.2 * k).toFixed(2);

  const r = ((CORNER_PCT / 100) * SIZE).toFixed(1);
  const clip = rounded
    ? `<clipPath id="squircle"><rect width="${SIZE}" height="${SIZE}" rx="${r}" ry="${r}"/></clipPath>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
  <defs>
    <radialGradient id="lit" cx="28%" cy="10%" r="112%">
      <stop offset="0%" stop-color="#FFE862"/>
      <stop offset="46%" stop-color="#FFD60A"/>
      <stop offset="100%" stop-color="#E4BB00"/>
    </radialGradient>
    <filter id="cast" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="${dy}" stdDeviation="${blur}" flood-color="${INK}" flood-opacity="0.3"/>
    </filter>${clip}
  </defs>
  <g${rounded ? ' clip-path="url(#squircle)"' : ""}>
    <rect width="${SIZE}" height="${SIZE}" fill="url(#lit)"/>
    <g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(6)})" fill="${INK}" filter="url(#cast)">
      <path d="${D}"/>
    </g>
  </g>
</svg>`;
}

const SQUARE = Buffer.from(iconSvg());
const ROUNDED = Buffer.from(iconSvg({ rounded: true }));
const MASKABLE = Buffer.from(iconSvg({ markPct: MASKABLE_PCT }));

const targets = [
  // Master / store art — full-bleed square.
  { file: "public/icons/icon-1024.png", size: 1024, src: SQUARE },
  // purpose:"any" — nothing masks these, so they carry their own squircle.
  { file: "public/icons/icon-512.png", size: 512, src: ROUNDED },
  { file: "public/icons/icon-192.png", size: 192, src: ROUNDED },
  // purpose:"maskable" — Android crops it, so full-bleed with the glyph pulled in.
  { file: "public/icons/icon-maskable-512.png", size: 512, src: MASKABLE },
  // Favicon / tab icon.
  { file: "src/app/icon.png", size: 512, src: ROUNDED },
  // iOS applies its own squircle to the home-screen tile, so this stays square.
  { file: "src/app/apple-icon.png", size: 180, src: SQUARE },
];

for (const t of targets) {
  await sharp(t.src, { density: 384 })
    .resize(t.size, t.size)
    .png({ compressionLevel: 9 })
    .toFile(join(ROOT, t.file));
  console.log(`OK ${t.file}  (${t.size}px)`);
}
console.log("Done - all icons regenerated from the locked mark.");
