// The launch splash, as geometry — shared by every script that rasterises it.
//
// Three things wear this design and must agree to the pixel, because a launch walks through
// them in order: the iOS startup image (`generate-pwa-startup-images.mjs`, the picture iOS
// shows from the icon tap until the page paints), the web splash (`#pwa-splash` in
// layout.tsx + globals.css, the page's own first frame), and the native shell splash
// (`generate-ios-splash.mjs`). If the image and the web splash differ by a pixel the lockup
// jumps at the hand-off; if the field differs in tint the whole screen blinks.
//
// The mark and the TRACKSIDE word are OUTLINES read from the locked brand files, so the
// scene renders identically on any machine and needs no font. The field is the app icon's
// "lit" yellow — the same radial gradient `generate-app-icons.mjs` paints — so the splash is
// the icon held open.
import { readFileSync } from "node:fs";

const here = new URL(".", import.meta.url);

const markSvg = readFileSync(new URL("../public/brand/jrc-mark-yellow.svg", here), "utf8");
export const MARK_D = markSvg.match(/ d="([^"]+)"/)[1];
export const MARK_VB = { w: 731, h: 241 };

// TRACKSIDE outlined; baseline at y=0, rising to -752.
export const WORD_D = readFileSync(new URL("./brand-word-trackside.txt", here), "utf8").trim();
export const WORD_VB = { w: 8243, h: 752 };

export const INK = "#121110";
export const YELLOW = "#FFD60A";

/**
 * The lit field. `r` in objectBoundingBox units stretches with the box, so on a tall phone
 * this is the same ellipse the web splash paints with
 * `radial-gradient(ellipse 112% 112% at 28% 10%, …)` (globals.css) — keep the two in step.
 */
export const LIT_FIELD_DEFS = `<radialGradient id="lit" cx="28%" cy="10%" r="112%">
      <stop offset="0%" stop-color="#FFE862"/>
      <stop offset="46%" stop-color="${YELLOW}"/>
      <stop offset="100%" stop-color="#E4BB00"/>
    </radialGradient>`;

/**
 * Lay the web splash out for one screen, in CSS px. Mirrors the rules under
 * `html[data-standalone="true"] #pwa-splash` in globals.css exactly:
 *
 *   mark width   min(47.7vw, 240px)
 *   mark → rule  0.118 × mark width          rule → word  0.118 − 0.032 = 0.086 × mark width
 *   lockup       centred in the web view, which starts UNDER the status bar
 *   foot         dots over the name, 14px apart, bottom edge max(54px, 28px + home bar)
 *
 * `statusBar` and `homeBar` are the device's insets in points. The page never sees the
 * status strip (statusBarStyle "default" keeps the web view below it) but the startup image
 * covers the whole screen, so the lockup is centred in the strip-less remainder.
 */
export function layoutSplash({ width: W, height: H, statusBar = 0, homeBar = 0 }) {
  const markW = Math.min(0.477 * W, 240);
  const markH = (markW * MARK_VB.h) / MARK_VB.w;
  const gap = 0.118 * markW;
  const ruleH = 1;
  const wordW = markW;
  const wordH = (wordW * WORD_VB.h) / WORD_VB.w;
  const ruleToWord = gap - 0.032 * markW;
  const lockupH = markH + gap + ruleH + ruleToWord + wordH;
  const top = statusBar + (H - statusBar - lockupH) / 2;
  const left = (W - markW) / 2;
  const ruleY = top + markH + gap;
  const wordY = ruleY + ruleH + ruleToWord;

  // Foot: 5px dots, 14px gap, a 14px name line (font-size 11px / line-height 14px).
  const dot = 5;
  const dotGap = 6;
  const nameH = 14;
  const footBottom = Math.max(54, 28 + homeBar);
  const footH = dot + 14 + nameH;
  const dotsY = H - footBottom - footH;
  const dotsLeft = (W - (3 * dot + 2 * dotGap)) / 2;

  return { markW, markH, left, top, ruleY, ruleH, wordW, wordH, wordY, dot, dotGap, dotsY, dotsLeft };
}

/**
 * The scene as an SVG string, `viewBox` in CSS px and `width`/`height` in device px.
 * The name line ("JRC DYNAMICS") is deliberately absent: it is live text on the web splash
 * and fades in there once the page has painted, over dots that do not move.
 */
export function splashSceneSvg({ width, height, dpr = 1, statusBar = 0, homeBar = 0 }) {
  const g = layoutSplash({ width, height, statusBar, homeBar });
  const f = (n) => n.toFixed(3);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width * dpr}" height="${height * dpr}">
  <defs>
    ${LIT_FIELD_DEFS}
  </defs>
  <rect width="${width}" height="${height}" fill="url(#lit)"/>
  <g transform="translate(${f(g.left)} ${f(g.top)}) scale(${(g.markW / MARK_VB.w).toFixed(6)})" fill="${INK}">
    <path fill-rule="evenodd" d="${MARK_D}"/>
  </g>
  <rect x="${f(g.left)}" y="${f(g.ruleY)}" width="${f(g.markW)}" height="${g.ruleH}" fill="${INK}" fill-opacity="0.42"/>
  <g transform="translate(${f(g.left)} ${f(g.wordY + g.wordH)}) scale(${(g.wordW / WORD_VB.w).toFixed(6)})" fill="${INK}">
    <path d="${WORD_D}"/>
  </g>
  ${[0, 1, 2]
    .map(
      (i) =>
        `<rect x="${f(g.dotsLeft + i * (g.dot + g.dotGap))}" y="${f(g.dotsY)}" width="${g.dot}" height="${g.dot}" rx="${g.dot / 2}" fill="${INK}" fill-opacity="${i === 0 ? 0.85 : 0.38}"/>`,
    )
    .join("\n  ")}
</svg>`;
}
