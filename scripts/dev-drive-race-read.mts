/**
 * Drive `/debug/race-read` in a real Chrome and print what the whole-frame read costs.
 *
 *   npx tsx scripts/dev-drive-race-read.mts <video path> [--email you@x] [--base http://localhost:3000] [--headless]
 *
 * Step 0 of `docs/VIDEO_RACE_PASS_PLAN.md`. Headed by default: hardware HEVC decoding needs the
 * GPU, and Playwright's bundled Chromium has no HEVC at all — a headless-Chromium run would
 * report numbers for a file it never decoded.
 *
 * Nothing is written to any database.
 */
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const flag = (name: string, dflt?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const VALUED = new Set(["--email", "--base"]);
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && VALUED.has(args[i - 1]!)));
const videoPath = positional[0];
if (!videoPath) {
  console.error("usage: dev-drive-race-read.mts <video path> [--email …] [--base …] [--headless]");
  process.exit(2);
}
const email = flag("email", "jordancaaruso@gmail.com")!;
const base = flag("base", "http://localhost:3000")!;
const headless = args.includes("--headless");

const browser = await chromium.launch({ channel: "chrome", headless });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

const lines: string[] = [];
page.on("console", (msg) => {
  const text = msg.text();
  if (/^\[(raceread|frames)\]/.test(text)) {
    lines.push(text);
    console.log("  " + text);
  }
});
page.on("pageerror", (e) => console.log("  PAGE ERROR " + e.message));

const started = Date.now();
await page.goto(`${base}/api/auth/dev-signin?email=${encodeURIComponent(email)}&to=/debug/race-read`);
await page.waitForLoadState("networkidle");
console.log(`opened ${page.url()}`);

const input = page.locator('input[type="file"]').first();
await input.waitFor({ state: "attached", timeout: 30_000 });
await input.setInputFiles(videoPath);
console.log(`handed over ${videoPath}`);

// The read is a couple of decode passes over ten seconds of video; give it room on a 4K file.
await page
  .locator("text=/VERDICT|FAILED|Failed:/")
  .first()
  .waitFor({ timeout: 15 * 60_000 })
  .catch(() => console.log("  (no verdict line inside 15 minutes)"));
await page.waitForTimeout(500);

await page.screenshot({ path: "e2e/.shots/race-read.png", fullPage: true });
console.log(`\nscreenshot e2e/.shots/race-read.png · ${Math.round((Date.now() - started) / 1000)}s`);

await browser.close();
