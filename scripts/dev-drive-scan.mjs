/**
 * Dev only: run "Find every crossing" end to end on a job and add what it found, so the saved
 * marks can be graded against the transponder with dev-check-crossings.mjs.
 *
 * Runs in the branded Edge (channel msedge): chrome-headless-shell cannot decode HEVC and hands the
 * canvas black frames. Headless by default, see the launch below.
 */
import { chromium } from "@playwright/test";
const BASE = "http://localhost:3000";
const JOB = process.env.JOB;
const VIDEO = process.env.VIDEO_PATH;
const OUT = process.env.SHOT_DIR;

// A headed window that is not in front gets its frame callbacks throttled and the scan reads
// nothing — "Too quick to read" at every speed, then "couldn't be read fast enough". These flags
// stop Chromium backgrounding an occluded window, and the page is brought to front regardless.
const browser = await chromium.launch({
  channel: "msedge",
  // Headless by default (HEADED=1 for a window). The branded Edge in its new headless mode decodes
  // HEVC fine — it was chrome-headless-shell that could not — and a headed window on a desktop
  // somebody is using gets minimised or covered, at which point the page is throttled to about a
  // frame a second and the whole scan starves. Half a day went on that before the page-state
  // probe below showed the window sitting at -32000,-32000.
  headless: process.env.HEADED !== "1",
  args: [
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    // Windows-specific: with this on, a window fully covered by another (VS Code in front, say)
    // is treated as invisible and never presents a frame, whatever the flags above say.
    "--disable-features=CalculateNativeWinOcclusion",
  ],
});
// Whatever happens below, the browser must not outlive the script: an orphaned headless shell
// kept burning CPU for hours after an earlier run threw, and starved every scan that followed.
process.on("uncaughtException", async (e) => { console.error(e?.message ?? e); try { await browser.close(); } catch {} process.exit(1); });
process.on("unhandledRejection", async (e) => { console.error(e?.message ?? e); try { await browser.close(); } catch {} process.exit(1); });
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
page.on("console", (m) => {
  if (m.type() === "error") console.log("  [err]", m.text().slice(0, 200));
  else if (m.text().startsWith("[scan]") || m.text().startsWith("[review]")) console.log("  " + m.text());
});

const t0 = Date.now();
const step = (s) => console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${s}`);

await page.goto(`${BASE}/api/auth/dev-signin?email=jordancaaruso@gmail.com`, { waitUntil: "domcontentloaded" });
step("signed in");
await page.goto(`${BASE}/videos/analysis/jobs/${JOB}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
step("job page open");
await page.locator('input[type="file"]').first().setInputFiles(VIDEO);
step("file attached");
// Picking a file lands on the Timing step, which has no player at all — the <video> only mounts
// on Sync and Mark. Waiting for it here (as an earlier version did) waits forever.
await page.waitForTimeout(2000);
await page.locator("button:visible", { hasText: /^Mark$/ }).first().click({ timeout: 20000 });
step("on Mark step");
await page.waitForFunction(() => { const v = document.querySelector("video"); return !!v && v.readyState >= 1 && v.videoWidth > 0; }, null, { timeout: 120000 });
const dims = await page.evaluate(() => { const v = document.querySelector("video"); return `${v.videoWidth}x${v.videoHeight} ${v.duration.toFixed(0)}s`; });
step(`video ready ${dims}`);
await page.waitForTimeout(1000);
await page.bringToFront();
// IDENTIFY=1 goes through the picture picker regardless of how sure the learning pass is.
if (process.env.IDENTIFY === "1") await page.getByRole("button", { name: /Show me the cars/ }).first().click({ timeout: 15000 });
else await page.getByRole("button", { name: /^Find every crossing$/ }).first().click({ timeout: 15000 });
step("scan started");
// What the page itself thinks is going on: a hidden or minimised page gets its frame callbacks
// throttled to about one a second, which the scan reports as "Too quick to read".
const pageState = setInterval(async () => {
  try {
    const st = await page.evaluate(() => {
      const v = document.querySelector("video");
      return {
        vis: document.visibilityState, focus: document.hasFocus(),
        win: [window.screenX, window.screenY, window.outerWidth, window.outerHeight].join(","),
        video: v ? (v.paused ? "paused" : "playing") + " rs" + v.readyState + " t" + v.currentTime.toFixed(2) + " x" + v.playbackRate + " " + v.getBoundingClientRect().width.toFixed(0) + "px" : "none",
      };
    });
    console.log("  [page]", JSON.stringify(st));
  } catch {}
}, 5000);


const started = Date.now();
const deadline = started + 25 * 60 * 1000;
let last = "";
let outcome = "timeout";
// A dev-server rebuild (another session saving a broken file, say) reloads the page, which drops
// the attached file and the scan with it. Notice within seconds instead of after the deadline.
let videoGone = 0;
// PICK_OFFSETS stands in for the driver at the picture picker: {"me":{"s1":2.07,…},"competitor":{…}}
// — seconds after the lap start at which THAT car reaches each line, taken from a truth set. The
// option nearest each offset is tapped, as a driver looking at the pictures would; a line whose
// nearest option is further than PICK_MAX_SEC (default 0.8) is left for the app to work out.
const pickOffsets = process.env.PICK_OFFSETS ? JSON.parse(process.env.PICK_OFFSETS) : null;
const pickMax = Number(process.env.PICK_MAX_SEC ?? 0.8);
let pickedRoles = 0;
while (Date.now() < deadline) {
  const body = await page.locator("body").innerText();
  const hasVideo = await page.evaluate(() => !!document.querySelector("video"));
  videoGone = hasVideo ? 0 : videoGone + 1;
  if (videoGone >= 3) { outcome = "error: page reloaded mid-scan (dev server rebuilt?) — video element gone"; break; }
  const pct = body.match(/Finding crossings\s+(\d+)%/)?.[1];
  const note = body.match(/(Reading|Cutting|Too quick|Learning the track|Checking the start line|Filling)[^\n]*/)?.[0];
  const line = `${pct ?? "?"}% ${note ?? ""}`.trim();
  if (line !== last) { last = line; console.log(`  … ${Math.round((Date.now() - started) / 1000)}s ${line}`); }
  if (/crossings? ready to add/i.test(body)) { outcome = "review"; break; }
  const asking = body.match(/Which one is (your car|.+?)\?/i);
  if (asking) {
    const role = /your car/i.test(asking[1]) ? "me" : "competitor";
    const offsets = pickOffsets?.[role];
    if (!offsets || pickedRoles >= 2) { outcome = "picker"; break; }
    pickedRoles++;
    // Every line's options as the screen shows them: the caption under each picture is its offset.
    const lines = await page.evaluate(() => {
      const out = [];
      for (const label of document.querySelectorAll("span.micro-caps")) {
        const key = label.textContent.trim().toLowerCase();
        if (!/^s\d+$/.test(key)) continue;
        const box = label.closest("div.space-y-1\\.5") ?? label.parentElement?.parentElement;
        const buttons = [...(box?.querySelectorAll("button") ?? [])].filter((b) => /\d+\.\d+s/.test(b.textContent));
        out.push({ key, options: buttons.map((b, i) => ({ i, off: Number(b.textContent.match(/(\d+\.\d+)s/)[1]) })) });
      }
      return out;
    });
    for (const l of lines) {
      const want = offsets[l.key];
      if (want == null || !l.options.length) { console.log(`  [pick] ${role} ${l.key}: no target, options ${l.options.map((o) => o.off).join(" ")}`); continue; }
      const best = l.options.reduce((a, o) => (Math.abs(o.off - want) < Math.abs(a.off - want) ? o : a));
      if (Math.abs(best.off - want) > pickMax) { console.log(`  [pick] ${role} ${l.key}: nearest ${best.off}s is ${(best.off - want).toFixed(2)}s from ${want}s — left for the app · options ${l.options.map((o) => o.off).join(" ")}`); continue; }
      await page.evaluate(([key, idx]) => {
        for (const label of document.querySelectorAll("span.micro-caps")) {
          if (label.textContent.trim().toLowerCase() !== key) continue;
          const box = label.closest("div.space-y-1\\.5") ?? label.parentElement?.parentElement;
          const buttons = [...(box?.querySelectorAll("button") ?? [])].filter((b) => /\d+\.\d+s/.test(b.textContent));
          buttons[idx]?.click();
        }
      }, [l.key, best.i]);
      console.log(`  [pick] ${role} ${l.key}: tapped ${best.off}s for ${want}s · options ${l.options.map((o) => o.off).join(" ")}`);
      await page.waitForTimeout(300);
    }
    await page.getByRole("button", { name: /^Find every crossing from/ }).first().click({ timeout: 10000 });
    console.log(`  [pick] ${role}: continued`);
    await page.waitForTimeout(3000);
    continue;
  }
  const err = body.match(/[^\n]*(could not|couldn.t|Couldn.t)[^\n]*/)?.[0];
  if (err && !/graphics acceleration/i.test(err)) { outcome = "error: " + err; break; }
  await page.waitForTimeout(3000);
}
clearInterval(pageState);
console.log("OUTCOME:", outcome, `after ${Math.round((Date.now() - started) / 1000)}s`);
await page.screenshot({ path: `${OUT}/scan-result.png`, fullPage: true });

const text = await page.locator("body").innerText();
if (outcome === "picker") { const j = text.indexOf("Which one is"); const k = text.indexOf("Find every crossing from"); console.log("\n--- picker ---\n" + text.slice(j, k + 40).replace(/\n+/g, " | ")); }
const i = text.indexOf("Found");
if (i >= 0) console.log("\n--- review ---\n" + text.slice(i, i + 700));

if (outcome === "review") {
  // "Add N" writes only the found rows; suspects stay out, which is what is being graded.
  const add = page.getByRole("button", { name: /^Add \d+$/ }).first();
  if (await add.count()) { await add.click(); await page.waitForTimeout(2500); console.log("ADDED"); }
  else console.log("no Add button — nothing found?");
}
await browser.close();
