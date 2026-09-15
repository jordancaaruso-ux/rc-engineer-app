/**
 * Run the race pass in a real Chrome against a real job, and print everything it said.
 *
 *   npx tsx scripts/dev-drive-race.mts <jobId> <video path> [--email you@x]
 *     [--base http://localhost:3000] [--headless] [--out file.log]
 *
 * Opens `/debug/race-pass`, hands the page the file, and streams the page's `[frames]`, `[race]`,
 * `[racepass]` and `[review]` console lines. **Nothing is written to any database** — the rig
 * reads the job's session and keeps its answers in the page, so a grading run can be repeated and
 * the job stays exactly as it was.
 *
 * Headed by default: hardware HEVC decoding needs the GPU, and Playwright's bundled Chromium has
 * no HEVC at all — a headless-Chromium run would report numbers for a file it never decoded.
 *
 * Do not save anything under `src/` while this runs: the dev server reloads the page and the pass
 * dies with it.
 */
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const flag = (name: string, dflt?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const VALUED = new Set(["--email", "--base", "--out", "--from", "--to", "--dump"]);
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && VALUED.has(args[i - 1]!)));
const [jobId, videoPath] = positional;
const from = flag("from");
const to = flag("to");
if (!jobId || !videoPath) {
  console.error("usage: dev-drive-race.mts <jobId> <video path> [--email …] [--base …] [--headless] [--out file.log]");
  process.exit(2);
}
const email = flag("email", "jordancaaruso@gmail.com")!;
const base = flag("base", "http://localhost:3000")!;
const outFile = flag("out");
const headless = args.includes("--headless");

const browser = await chromium.launch({ channel: "chrome", headless });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

const lines: string[] = [];
page.on("console", (msg) => {
  const text = msg.text();
  if (/^\[(frames|race|racepass|review)\]/.test(text)) {
    lines.push(text);
    console.log("  " + text);
  }
});
page.on("pageerror", (e) => {
  const text = `PAGE ERROR ${e.message}`;
  lines.push(text);
  console.log("  " + text);
});

const started = Date.now();
await page.goto(
  `${base}/api/auth/dev-signin?email=${encodeURIComponent(email)}&to=${encodeURIComponent(
    `/debug/race-pass?job=${jobId}${from && to ? `&from=${from}&to=${to}` : ""}`
  )}`
);
await page.waitForLoadState("networkidle");
console.log(`opened ${page.url()}`);

const input = page.locator('input[type="file"]').first();
await input.waitFor({ state: "attached", timeout: 60_000 });
// The picker stays disabled until the job's session has loaded.
for (let i = 0; i < 60 && (await input.isDisabled()); i++) await page.waitForTimeout(500);
if (await input.isDisabled()) {
  console.log("  the job never loaded — check the id and that this account owns it");
  console.log("  status: " + (await page.locator("main p").first().innerText().catch(() => "?")));
  await browser.close();
  process.exit(1);
}
await input.setInputFiles(videoPath);
console.log(`handed over ${videoPath}`);

await page
  .locator("text=/DONE |FAILED /")
  .first()
  .waitFor({ timeout: 60 * 60_000 })
  .catch(() => console.log("  (no DONE line inside an hour)"));
await page.waitForTimeout(500);

// Everything the pass saw, so the rules after it can be tried again without reading the file.
const dumpFile = flag("dump");
if (dumpFile) {
  const dump = await page.evaluate(() => (window as unknown as { __racePassDump?: unknown }).__racePassDump ?? null);
  if (dump) {
    writeFileSync(dumpFile, JSON.stringify(dump), "utf8");
    console.log(`wrote ${dumpFile}`);
  } else {
    console.log("  no dump on the page — the pass did not finish");
  }
}

await page.screenshot({ path: `e2e/.shots/race-${jobId}.png`, fullPage: true });
if (outFile) {
  writeFileSync(outFile, lines.join("\n") + "\n", "utf8");
  console.log(`\nwrote ${outFile}`);
}
console.log(`screenshot e2e/.shots/race-${jobId}.png · ${Math.round((Date.now() - started) / 1000)}s`);

await browser.close();
