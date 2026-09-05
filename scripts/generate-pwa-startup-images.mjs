// Generates the iOS home-screen "startup images" — the picture iOS shows from the moment
// the icon is tapped until the page has painted its first frame — and the metadata that
// wires them up.
//
// Without these, iOS shows its own blank launch screen (white, or black on a phone in dark
// mode) until the HTML arrives, so a cold launch read as black → white → the yellow splash
// (founder report, 2026-09-04). With them the yellow field with the lockup is up from the
// first frame, and the web splash (`#pwa-splash`) is drawn to the same geometry
// (`splash-scene.mjs`), so the hand-off from picture to page is invisible.
//
// iOS picks an image by an exact media query — device width, height, pixel ratio and
// orientation — and falls back to blank if none matches, so there is one file per screen
// size. Same-size devices share a file even where their status bars differ by a few points
// (the 12 mini's 50pt vs the X's 44pt); the lockup then lands a pixel or two off centre at
// the hand-off, which is the lesser evil against a blank screen.
//
// Writes:
//   public/brand/splash/startup-{W}x{H}.png   one per screen, device pixels
//   src/lib/pwa/startupImages.ts              the `appleWebApp.startupImage` array
//
// Run:  node scripts/generate-pwa-startup-images.mjs
import sharp from "sharp";
import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { splashSceneSvg } from "./splash-scene.mjs";

const OUT_DIR = "public/brand/splash";
const OUT_TS = "src/lib/pwa/startupImages.ts";

// CSS points, portrait. `sb` = status bar height, `hb` = home-indicator inset (0 on a
// home-button device). Where two devices share a size the more common one's bars win.
const IPHONES = [
  { w: 440, h: 956, dpr: 3, sb: 62, hb: 34, names: "16 Pro Max" },
  { w: 402, h: 874, dpr: 3, sb: 62, hb: 34, names: "16 Pro" },
  { w: 430, h: 932, dpr: 3, sb: 59, hb: 34, names: "14 Pro Max · 15 Plus · 15 Pro Max · 16 Plus" },
  { w: 393, h: 852, dpr: 3, sb: 59, hb: 34, names: "14 Pro · 15 · 15 Pro · 16" },
  { w: 428, h: 926, dpr: 3, sb: 47, hb: 34, names: "12 Pro Max · 13 Pro Max · 14 Plus" },
  { w: 390, h: 844, dpr: 3, sb: 47, hb: 34, names: "12 · 12 Pro · 13 · 13 Pro · 14" },
  { w: 375, h: 812, dpr: 3, sb: 47, hb: 34, names: "X · XS · 11 Pro · 12 mini · 13 mini" },
  { w: 414, h: 896, dpr: 3, sb: 44, hb: 34, names: "XS Max · 11 Pro Max" },
  { w: 414, h: 896, dpr: 2, sb: 48, hb: 34, names: "XR · 11" },
  { w: 414, h: 736, dpr: 3, sb: 20, hb: 0, names: "6 Plus · 7 Plus · 8 Plus" },
  { w: 375, h: 667, dpr: 2, sb: 20, hb: 0, names: "6 · 7 · 8 · SE 2 · SE 3" },
  { w: 320, h: 568, dpr: 2, sb: 20, hb: 0, names: "SE 1" },
];

// iPads launch in either orientation, so each gets a portrait and a landscape image.
const IPADS = [
  { w: 1032, h: 1376, dpr: 2, sb: 24, hb: 20, names: 'Pro 13" M4' },
  { w: 1024, h: 1366, dpr: 2, sb: 24, hb: 20, names: 'Pro 12.9"' },
  { w: 834, h: 1210, dpr: 2, sb: 24, hb: 20, names: 'Pro 11" M4' },
  { w: 834, h: 1194, dpr: 2, sb: 24, hb: 20, names: 'Pro 11"' },
  { w: 820, h: 1180, dpr: 2, sb: 24, hb: 20, names: "Air 4 · Air 5 · 10th gen" },
  { w: 834, h: 1112, dpr: 2, sb: 20, hb: 0, names: 'Pro 10.5" · Air 3' },
  { w: 810, h: 1080, dpr: 2, sb: 20, hb: 0, names: "7th–9th gen" },
  { w: 768, h: 1024, dpr: 2, sb: 20, hb: 0, names: "mini 5 · older 9.7\"" },
  { w: 744, h: 1133, dpr: 2, sb: 24, hb: 20, names: "mini 6 · mini 7" },
];

const screens = [
  ...IPHONES.map((d) => ({ ...d, orientation: "portrait" })),
  ...IPADS.flatMap((d) => [
    { ...d, orientation: "portrait" },
    { ...d, w: d.h, h: d.w, orientation: "landscape" },
  ]),
];

mkdirSync(OUT_DIR, { recursive: true });
for (const stale of readdirSync(OUT_DIR)) {
  if (stale.startsWith("startup-") && stale.endsWith(".png")) unlinkSync(join(OUT_DIR, stale));
}

const entries = [];
let totalBytes = 0;
for (const s of screens) {
  const svg = splashSceneSvg({ width: s.w, height: s.h, dpr: s.dpr, statusBar: s.sb, homeBar: s.hb });
  const png = await sharp(Buffer.from(svg), { density: 72 * s.dpr })
    .resize(s.w * s.dpr, s.h * s.dpr)
    // The field spans three close yellows, so a 256-colour palette holds it without banding
    // and a light dither is enough: ~27kB a picture against ~120kB truecolour (measured
    // 2026-09-04). Thirty of them live in the repo, and iOS reads one per launch.
    .png({ palette: true, quality: 90, dither: 0.2, compressionLevel: 9 })
    .toBuffer();
  const file = `startup-${s.w * s.dpr}x${s.h * s.dpr}.png`;
  writeFileSync(join(OUT_DIR, file), png);
  totalBytes += png.length;
  // Portrait and landscape of the same iPad share `device-width`/`device-height` (iOS
  // reports them portrait-wise), so the query needs the orientation to tell them apart.
  const dw = s.orientation === "landscape" ? s.h : s.w;
  const dh = s.orientation === "landscape" ? s.w : s.h;
  entries.push({
    url: `/brand/splash/${file}`,
    media: `screen and (device-width: ${dw}px) and (device-height: ${dh}px) and (-webkit-device-pixel-ratio: ${s.dpr}) and (orientation: ${s.orientation})`,
    note: `${s.orientation === "landscape" ? "iPad" : dw >= 744 ? "iPad" : "iPhone"} ${s.names}`,
  });
  console.log(`OK ${OUT_DIR}/${file}  ${(png.length / 1024).toFixed(0)}kB  ${s.names} (${s.orientation})`);
}

const ts = `/**
 * iOS home-screen startup images — \`appleWebApp.startupImage\` in \`layout.tsx\`.
 *
 * GENERATED by \`scripts/generate-pwa-startup-images.mjs\` — edit the device table there,
 * never this file. iOS matches one entry by exact media query and shows that picture from
 * the icon tap until the page paints; the pictures are the launch splash drawn to the same
 * geometry as \`#pwa-splash\`, so the hand-off is invisible. No match means a blank screen,
 * which is what the app showed before 2026-09-04.
 */
export const PWA_STARTUP_IMAGES: ReadonlyArray<{ url: string; media: string }> = [
${entries.map((e) => `  // ${e.note}\n  { url: "${e.url}", media: "${e.media}" },`).join("\n")}
];
`;
writeFileSync(OUT_TS, ts);
console.log(`wrote ${entries.length} images (${(totalBytes / 1024 / 1024).toFixed(2)} MB) + ${OUT_TS}`);
