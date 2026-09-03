/**
 * Drive "Find every crossing" in a real Chrome against a real job, and print what the scan said.
 *
 * The headless harness (`find-crossings-job.ts`) decodes with ffmpeg; the app decodes in the
 * browser. Whether the two agree is the one thing the harness cannot tell you, and it is the
 * thing that went wrong at Bendigo (2026-09-02): the browser's playback reader dropped the two
 * frames a far car was on the line, and the harness never saw a problem.
 *
 *   npx tsx scripts/dev-drive-scan.mts <jobId> <video path> [--email you@x] [--base http://localhost:3000]
 *     [--headless] [--playback]
 *
 * Signs in through the dev door, opens the job, hands the page the file, walks to the scan
 * button, presses it, and streams the page's `[frames]`, `[scan]` and `[review]` console lines.
 * Headed by default: hardware HEVC decoding — a phone's codec — is only there with a GPU.
 * Writes the job's `lastScan` on the scratch-dev database, exactly as a real press would.
 */
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const flag = (name: string, dflt?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const [jobId, videoPath] = args.filter((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1]!.startsWith("--")));
if (!jobId || !videoPath) {
  console.error("usage: dev-drive-scan.mts <jobId> <video path> [--email …] [--base …] [--headless]");
  process.exit(2);
}
const email = flag("email", "jordancaaruso@gmail.com")!;
const base = flag("base", "http://localhost:3000")!;
const headless = args.includes("--headless");
/** `--playback` forces the old reader (the support knob in `frameSource.ts`), for a comparison. */
const playback = args.includes("--playback");

const browser = await chromium.launch({ channel: "chrome", headless });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

const lines: string[] = [];
page.on("console", (msg) => {
  const text = msg.text();
  if (/^\[(frames|scan|review)\]/.test(text)) {
    lines.push(text);
    console.log("  " + text);
  }
});
page.on("pageerror", (e) => console.log("  PAGE ERROR " + e.message));

const started = Date.now();
await page.goto(`${base}/api/auth/dev-signin?email=${encodeURIComponent(email)}&to=/videos/analysis/jobs/${jobId}`);
await page.waitForLoadState("networkidle");
console.log(`opened ${page.url()}`);
if (playback) {
  await page.evaluate(() => window.localStorage.setItem("rc_frame_reader", "playback"));
  console.log("forcing the playback reader");
} else {
  await page.evaluate(() => window.localStorage.removeItem("rc_frame_reader"));
}

// Hand the page the file. The job remembers the file's name and asks for it again.
const input = page.locator('input[type="file"]').first();
await input.waitFor({ state: "attached", timeout: 30_000 });
await input.setInputFiles(videoPath);
console.log("file handed over");
await page.waitForTimeout(1500);

// The scan button lives on the Scan step. A finished job opens on Compare, whose rail has a chip
// for every step; an unfinished one is walked forward with its Continue buttons.
const scanButton = page.getByRole("button", { name: /Find every crossing/ });
// The rail shows "SCAN" through CSS; the DOM says "Scan".
const markChip = page.getByRole("button", { name: /^scan$/i }).first();
if (!(await scanButton.isVisible().catch(() => false)) && (await markChip.isVisible().catch(() => false))) {
  console.log(`  SCAN chip enabled: ${await markChip.isEnabled()}`);
  await markChip.click({ force: true });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "e2e/.shots/drive-scan-mark.png", fullPage: true });
}
for (let i = 0; i < 8 && !(await scanButton.isVisible().catch(() => false)); i++) {
  const names = await page.getByRole("button").allInnerTexts();
  console.log(`  buttons: ${names.map((n) => n.replace(/\s+/g, " ").trim()).filter(Boolean).join(" | ")}`);
  const next = page.getByRole("button", { name: /^(Continue|Next|Continue to .*)$/ }).first();
  if (!(await next.isVisible().catch(() => false))) break;
  await next.click();
  await page.waitForTimeout(800);
}
if (!(await scanButton.isVisible().catch(() => false))) {
  await page.screenshot({ path: "e2e/.shots/drive-scan-lost.png", fullPage: true });
  console.error("could not reach the scan button — screenshot at e2e/.shots/drive-scan-lost.png");
  await browser.close();
  process.exit(1);
}

console.log("pressing Find every crossing");
const pressed = Date.now();
await scanButton.click();

// Done when the review has been logged and the page has settled, or after a generous timeout.
const deadline = Date.now() + 15 * 60_000;
let sawReview = false;
while (Date.now() < deadline) {
  await page.waitForTimeout(1000);
  if (lines.some((l) => l.startsWith("[review]"))) {
    sawReview = true;
    // Give the trailing review lines a moment to land.
    await page.waitForTimeout(3000);
    break;
  }
  const err = page.locator("text=/couldn't|could not|failed|error/i").first();
  if (await err.isVisible().catch(() => false)) {
    console.log("  page says: " + (await err.innerText()));
  }
}
const scanMs = Date.now() - pressed;
await page.screenshot({ path: "e2e/.shots/drive-scan-done.png", fullPage: true });

const found = lines.filter((l) => l.startsWith("[review] found")).length;
const suspect = lines.filter((l) => l.startsWith("[review] suspect")).length;
const missing = lines.filter((l) => l.startsWith("[review] missing")).length;
const reader = lines.find((l) => l.startsWith("[frames]")) ?? "(reader not logged)";
const starved = lines.filter((l) => l.startsWith("[scan]") && l.includes("STARVED")).length;
console.log(
  `\n${reader}\nscan took ${(scanMs / 1000).toFixed(0)}s (${((Date.now() - started) / 1000).toFixed(0)}s with sign-in)` +
    `\nfound ${found} · held ${suspect} · missing ${missing} · starved stretches ${starved}${sawReview ? "" : "\nNO REVIEW LOGGED — the scan did not finish"}`
);
await browser.close();
