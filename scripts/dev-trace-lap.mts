/**
 * Press the Trace chips in a real Chrome against a real job, and print what the tracer said.
 *
 *   npx tsx scripts/dev-trace-lap.mts <jobId> <video path> [--laps 8,5,4] [--their 16,4]
 *     [--driver Justin] [--against me] [--skip-traced] [--email you@x] [--dump dir]
 *     [--base http://localhost:3000] [--headless]
 *
 * Signs in through the dev door, opens the job on the compare step, hands the page the file, and
 * traces every lap asked for: `--laps` are yours (tapped in the sheet), `--their` are the
 * overlay driver's (tapped on the Their lap row). `--driver` picks that driver by name first,
 * `--against me` reads the sheet against your own best lap instead. `--lap 7|best --both` is the
 * old single-lap form and still works. Streams the page's `[frames]` and `[trace]` console lines.
 *
 * `--dump <dir>` writes every lap's raw sightings there, one file a lap. Reading a lap costs a
 * browser and eight seconds; choosing its path from what was read costs nothing, so a dump lets
 * `scripts/tmp/replay-grade.mts` try a different way of picking the path over the whole grading
 * set in a second.
 *
 * Headed by default: hardware HEVC decoding needs the GPU. Writes `traces` on the job's session
 * on whatever database `.env.local` points at, exactly as a real press would. Grade the result
 * with `scripts/dev-grade-trace.mts`.
 *
 * Do not save anything under `src/` while this runs: the dev server reloads the page and the
 * trace dies with it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Locator } from "@playwright/test";

const args = process.argv.slice(2);
const flag = (name: string, dflt?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const VALUED = new Set(["--lap", "--laps", "--their", "--driver", "--email", "--base", "--against", "--dump"]);
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && VALUED.has(args[i - 1]!)));
const [jobId, videoPath] = positional;
if (!jobId || !videoPath) {
  console.error(
    "usage: dev-trace-lap.mts <jobId> <video path> [--laps 8,5] [--their 16] [--driver Name] [--against me] [--skip-traced] [--headless]"
  );
  process.exit(2);
}
const email = flag("email", "jordancaaruso@gmail.com")!;
const base = flag("base", "http://localhost:3000")!;
const lapArg = flag("lap");
const numbers = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
const myLaps = numbers(flag("laps"));
const theirLaps = numbers(flag("their"));
const driverName = flag("driver");
const against = flag("against");
const both = args.includes("--both");
const skipTraced = args.includes("--skip-traced");
const dumpDir = flag("dump");
const headless = args.includes("--headless");

const browser = await chromium.launch({ channel: "chrome", headless });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

const lines: string[] = [];
page.on("console", (msg) => {
  const text = msg.text();
  if (/^\[(frames|trace)\]/.test(text)) {
    lines.push(text);
    console.log("  " + text);
  }
});
page.on("pageerror", (e) => console.log("  PAGE ERROR " + e.message));

const started = Date.now();
await page.goto(`${base}/api/auth/dev-signin?email=${encodeURIComponent(email)}&to=/videos/analysis/jobs/${jobId}`);
await page.waitForLoadState("networkidle");
console.log(`opened ${page.url()}`);
await page.evaluate(() => window.localStorage.removeItem("rc_frame_reader"));
// Measurement door: pin the lap on the start line alone, so the crossings the scan found are not
// the thing holding the path in place. See `LapAnchorOptions.cornersOff`.
const cornersOff = args.includes("--corners-off");
await page.evaluate((on) => {
  if (on) window.localStorage.setItem("rc_trace_corners_off", "1");
  else window.localStorage.removeItem("rc_trace_corners_off");
}, cornersOff);
if (cornersOff) console.log("corners OFF — the lap is pinned on the start line only");
if (dumpDir) {
  mkdirSync(dumpDir, { recursive: true });
  await page.evaluate(() => {
    (window as unknown as { __traceDump: unknown[] }).__traceDump = [];
  });
  console.log("dumping sightings to " + dumpDir);
}

/** Take whatever the page has collected since the last call and write a file per lap. */
async function drainDump() {
  if (!dumpDir) return;
  const got = await page.evaluate(() => {
    const w = window as unknown as { __traceDump?: unknown[] };
    const out = w.__traceDump ?? [];
    w.__traceDump = [];
    return out as Array<{ driverRole: string; lapNumber: number }>;
  });
  for (const d of got) {
    const name = jobId + "-" + d.driverRole + "-L" + d.lapNumber + ".json";
    writeFileSync(dumpDir + "/" + name, JSON.stringify(d));
    console.log("  dumped " + name);
  }
}

// Hand the page the file. The job remembers the file's name and asks for it again — on the
// compare step only when it has no uploaded copy to play. A job that does have one plays that
// and asks nowhere, so the set-up step, which always offers the file, is where it is handed over.
const input = page.locator('input[type="file"]').first();
const askedOnOpen = await input.waitFor({ state: "attached", timeout: 3_000 }).then(() => true, () => false);
if (!askedOnOpen) {
  const setUpChip = page.getByRole("button", { name: /^set up$/i }).first();
  await setUpChip.click({ force: true });
  await page.waitForTimeout(1500);
  console.log("no file asked for on open — handing it over on the set-up step");
}
await input.waitFor({ state: "attached", timeout: 30_000 });
await input.setInputFiles(videoPath);
console.log("file handed over");
await page.waitForTimeout(2000);

// The compare step. A finished job opens on it; otherwise its rail chip is a click away.
const compareChip = page.getByRole("button", { name: /^compare$/i }).first();
if (await compareChip.isVisible().catch(() => false)) {
  await compareChip.click({ force: true });
  await page.waitForTimeout(1500);
}

// Whose laps the sheet is read against.
if (driverName) {
  const chip = page.getByRole("button", { name: new RegExp(driverName, "i") }).first();
  if (await chip.isVisible().catch(() => false)) {
    await chip.click();
    await page.waitForTimeout(800);
    console.log(`against: ${(await chip.innerText()).replace(/\s+/g, " ").trim()}`);
  }
}
if (against === "me") {
  const mine = page.getByRole("button", { name: /^My best lap$/ }).first();
  if (await mine.isVisible().catch(() => false)) {
    await mine.click();
    await page.waitForTimeout(800);
    console.log("against: my best lap");
  }
}

/** A lap button, inside the sheet (yours) or outside it (the Their lap row). */
async function lapButton(n: number | "best", where: "table" | "controls"): Promise<Locator | null> {
  const name = n === "best" ? /^L\d+ · [\d.]+\s*best lap/ : new RegExp(`^L${n} · `);
  for (const b of await page.getByRole("button", { name }).all()) {
    const inTable = await b.evaluate((el) => !!el.closest("table"));
    if (inTable === (where === "table")) return b;
  }
  return null;
}

/** The Trace chips on screen, as [lap number, button text] — a traced lap's chip reads "L7 traced". */
async function traceChips(): Promise<Array<{ lap: number; text: string; traced: boolean }>> {
  const out: Array<{ lap: number; text: string; traced: boolean }> = [];
  for (const b of await page.getByRole("button", { name: /^(Trace L\d+|L\d+ traced)/ }).all()) {
    const text = (await b.innerText()).replace(/\s+/g, " ").trim();
    const m = /^Trace L(\d+)/.exec(text) ?? /^L(\d+) traced$/.exec(text);
    if (m) out.push({ lap: Number(m[1]), text, traced: /traced$/.test(text) });
  }
  return out;
}

async function pressTrace(lap: number | null, label: string, exclude?: number): Promise<boolean> {
  const chips = await traceChips();
  const target = lap == null ? chips.find((c) => c.lap !== exclude) : chips.find((c) => c.lap === lap);
  if (!target) {
    console.log(`  no chip for ${label}; chips: ${chips.map((c) => c.text).join(" | ") || "(none)"}`);
    return false;
  }
  if (skipTraced && target.traced) {
    console.log(`  ${label}: already traced, skipped`);
    return true;
  }
  const chip = page
    .getByRole("button", { name: new RegExp(`^${target.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) })
    .first();
  const before = lines.length;
  console.log(`pressing ${target.text}`);
  const pressed = Date.now();
  await chip.click();
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    if (lines.slice(before).some((l) => l.startsWith("[trace] done"))) break;
    const err = page.locator("text=/couldn't|could not|failed|error|out of bounds/i").first();
    if (await err.isVisible().catch(() => false)) {
      console.log("  page says: " + (await err.innerText()).replace(/\s+/g, " ").trim());
      break;
    }
  }
  const done = lines.slice(before).some((l) => l.startsWith("[trace] done"));
  console.log(`  ${label}: ${done ? "done" : "NO DONE LINE"} in ${((Date.now() - pressed) / 1000).toFixed(0)}s`);
  // Let the debounced save land before anything else moves.
  await page.waitForTimeout(2000);
  await drainDump();
  return done;
}

let ok = 0;
let asked = 0;

/** Tap a lap so it is on the player, then trace it. */
async function traceOne(n: number | "best", where: "table" | "controls", label: string) {
  asked++;
  const btn = await lapButton(n, where);
  if (!btn) {
    console.log(`  ${label}: no lap ${where === "table" ? "row" : "chip"} for L${n}`);
    return;
  }
  const text = (await btn.innerText()).replace(/\s+/g, " ").trim();
  await btn.click();
  await page.waitForTimeout(700);
  const lap = n === "best" ? Number(/L(\d+)/.exec(text)?.[1] ?? "0") : n;
  console.log(`${label}: ${text}`);
  if (await pressTrace(lap, `${label} L${lap}`)) ok++;
}

// The old single-lap form: --lap 7|best [--both].
if (lapArg) {
  const btn = await lapButton(lapArg === "best" ? "best" : Number(lapArg), "table");
  if (!btn) {
    await page.screenshot({ path: `e2e/.shots/trace-${jobId}-lost.png`, fullPage: true });
    console.error(`could not find the lap row for ${lapArg} — screenshot at e2e/.shots/trace-${jobId}-lost.png`);
    await browser.close();
    process.exit(1);
  }
  const text = (await btn.innerText()).replace(/\s+/g, " ").trim();
  const lapNumber = Number(/L(\d+)/.exec(text)?.[1] ?? "0");
  await btn.click();
  await page.waitForTimeout(800);
  console.log(`solid lap: ${text}`);
  asked++;
  if (await pressTrace(lapNumber, `L${lapNumber}`)) ok++;
  if (both) {
    asked++;
    if (await pressTrace(null, "the ghost lap", lapNumber)) ok++;
  }
}

for (const n of myLaps) await traceOne(n, "table", "mine");
for (const n of theirLaps) await traceOne(n, "controls", "theirs");

await page.screenshot({ path: `e2e/.shots/trace-${jobId}.png`, fullPage: true });
console.log(
  `\nscreenshot e2e/.shots/trace-${jobId}.png · ${ok}/${asked} traced · ${((Date.now() - started) / 1000).toFixed(0)}s with sign-in`
);
await browser.close();
