// Regenerates the 1200x630 link-preview card from scripts/og-card/card.html.
//
// Rendered in a real browser rather than composited with sharp (the way generate-app-icons.mjs
// builds the icons) for one reason: Sora and Space Grotesk are Google-hosted and are NOT installed
// on this machine, so librsvg silently substitutes DejaVu for any SVG <text>. The headline would
// ship in the wrong typeface and nothing would fail loudly. A browser fetches the real face, and
// backdrop blur, gradients and layered shadows come for free.
//
// IMPORTANT — the filename is versioned on purpose. iMessage, WhatsApp, Slack and Discord cache
// preview images by URL and hold them for a long time. Overwriting og-card.jpg in place would keep
// showing the old picture to everyone who has already seen the link. When this card changes
// again, bump to -v3 and repoint the two meta tags in public/landing/index.html.
//
// Run:  node scripts/generate-og-card.mjs

import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CARD = join(ROOT, "scripts/og-card/card.html");
const OUT = join(ROOT, "public/landing/assets/og-card-v2.jpg");

const WIDTH = 1200;
const HEIGHT = 630;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  // Render at 2x and let the JPEG encoder downsample: the phone screenshot is being scaled to
  // ~62% and the answer text inside it has to survive a message bubble rendering the whole card
  // near 360px wide.
  deviceScaleFactor: 2,
});

await page.goto(pathToFileURL(CARD).href, { waitUntil: "networkidle" });
// networkidle covers the Google Fonts CSS, not necessarily the face itself.
await page.evaluate(() => document.fonts.ready);

await page.screenshot({
  path: OUT,
  type: "jpeg",
  quality: 88,
  clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
  scale: "css",
});

await browser.close();
console.log(`✓ ${OUT}  (${WIDTH}x${HEIGHT})`);
console.log("  Remember: og:image + twitter:image in public/landing/index.html must point here.");
