// Regenerates the iOS shell's launch splash (`ios/App/App/Assets.xcassets/Splash.imageset`)
// from the locked mark, so the native launch wears the same design as the web one
// (`#pwa-splash`, globals.css): the app icon's lit yellow field with the ink lockup on it.
//
// The geometry is read verbatim from `public/brand/jrc-mark-yellow.svg` and the TRACKSIDE
// wordmark from `scripts/brand-word-trackside.txt` — both are outlines, so this renders the
// same on any machine. The web splash's "JRC DYNAMICS" footer line is deliberately NOT here:
// it is live text there, and baking it would mean depending on whichever fonts the build
// machine happens to have installed.
//
// Geometry note. Capacitor scales this square aspect-FILL. On any portrait screen that means
// scale = screenHeight / 2732, so the full height is visible and the width is cropped to the
// central `screenWidth / screenHeight` slice. Everything therefore sizes off that visible
// slice, measured against the founder artboard (390x844, mark 186 wide, foot 54 up):
//
//   visible width on a 390x844 phone = 2732 * 390/844 = 1262px  <->  390pt
//
// Run:  node scripts/generate-ios-splash.mjs   (then `npm run cap:sync`)
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// The mark, the word and the lit field come from the one shared scene module, so this,
// the iOS startup images and the web splash cannot drift apart in geometry or tint.
import { INK, LIT_FIELD_DEFS, MARK_D, MARK_VB, WORD_D, WORD_VB } from "./splash-scene.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const SIZE = 2732;

// The artboard, and this square's px per artboard pt on a 390x844 phone.
const ART = { w: 390, h: 844, mark: 186, foot: 54, rule: 16, gap: 22, word: 15 };
const PX = (SIZE * (ART.w / ART.h)) / ART.w; // 3.2372

const markW = ART.mark * PX;
const markH = (markW * MARK_VB.h) / MARK_VB.w;
// The word is set to the mark's width, matching the web splash's `space-between` spread.
const wordW = markW;
const wordH = (wordW * WORD_VB.h) / WORD_VB.w;
const gap = ART.gap * PX;
const ruleGap = ART.rule * PX;

const lockupH = markH + gap + 1 * PX + ruleGap + wordH;
const top = (SIZE - lockupH) / 2;
const left = (SIZE - markW) / 2;
const ruleY = top + markH + gap;
const wordY = ruleY + 1 * PX + ruleGap;

// The three-dot rest state, sitting where the web splash's foot sits.
const dot = 5 * PX;
const dotGap = 6 * PX;
const dotsY = SIZE - ART.foot * PX - dot;
const dotsLeft = (SIZE - (3 * dot + 2 * dotGap)) / 2;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
  <defs>
    ${LIT_FIELD_DEFS}
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#lit)"/>
  <g transform="translate(${left.toFixed(2)} ${top.toFixed(2)}) scale(${(markW / MARK_VB.w).toFixed(6)})" fill="${INK}">
    <path fill-rule="evenodd" d="${MARK_D}"/>
  </g>
  <rect x="${left.toFixed(2)}" y="${ruleY.toFixed(2)}" width="${markW.toFixed(2)}" height="${(1 * PX).toFixed(2)}" fill="${INK}" fill-opacity="0.42"/>
  <g transform="translate(${left.toFixed(2)} ${(wordY + wordH).toFixed(2)}) scale(${(wordW / WORD_VB.w).toFixed(6)})" fill="${INK}">
    <path d="${WORD_D}"/>
  </g>
  ${[0, 1, 2]
    .map(
      (i) =>
        `<rect x="${(dotsLeft + i * (dot + dotGap)).toFixed(2)}" y="${dotsY.toFixed(2)}" width="${dot.toFixed(2)}" height="${dot.toFixed(2)}" rx="${(dot / 2).toFixed(2)}" fill="${INK}" fill-opacity="${i === 0 ? 0.85 : 0.38}"/>`,
    )
    .join("\n  ")}
</svg>`;

const png = await sharp(Buffer.from(svg), { density: 384 })
  .resize(SIZE, SIZE)
  .png({ compressionLevel: 9 })
  .toBuffer();

// One image, three entries in Contents.json (1x/2x/3x) — Capacitor's default scaffold.
for (const name of [
  "splash-2732x2732.png",
  "splash-2732x2732-1.png",
  "splash-2732x2732-2.png",
]) {
  writeFileSync(join(ROOT, "ios/App/App/Assets.xcassets/Splash.imageset", name), png);
  console.log(`OK ios/.../Splash.imageset/${name}`);
}
console.log("Done - run `npm run cap:sync` to carry it into the shell.");
