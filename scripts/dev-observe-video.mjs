/**
 * Dev only: attach a file on the analyze page and report what the <video> element actually does,
 * every few seconds, for a minute. For when "the player never became ready" needs a cause.
 */
import { chromium } from "@playwright/test";
const BASE = "http://localhost:3000";
const JOB = process.env.JOB;
const VIDEO = process.env.VIDEO_PATH;

const browser = await chromium.launch({ channel: "msedge", headless: false });
process.on("uncaughtException", async (e) => { console.error(e?.message ?? e); try { await browser.close(); } catch {} process.exit(1); });
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("  [page]", m.text().slice(0, 240)); });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 240)));

await page.goto(`${BASE}/api/auth/dev-signin?email=jordancaaruso@gmail.com`, { waitUntil: "domcontentloaded" });
await page.goto(`${BASE}/videos/analysis/jobs/${JOB}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await page.locator('input[type="file"]').first().setInputFiles(VIDEO);
const t0 = Date.now();

for (let i = 0; i < 12; i++) {
  const s = await page.evaluate(() => {
    const vids = [...document.querySelectorAll("video")].map((v) => ({
      src: (v.currentSrc || v.src || "").slice(0, 40),
      ready: v.readyState,
      net: v.networkState,
      w: v.videoWidth,
      h: v.videoHeight,
      dur: Number.isFinite(v.duration) ? Math.round(v.duration) : null,
      err: v.error ? `${v.error.code}:${v.error.message}` : null,
      visible: !!v.offsetParent,
    }));
    const banner = [...document.querySelectorAll("p,div")].map((e) => e.textContent?.trim() ?? "")
      .filter((t) => /HEVC|graphics|can't|cannot|couldn|no picture|decode/i.test(t) && t.length < 260)[0] ?? null;
    const buttons = [...document.querySelectorAll("button")].filter((b) => b.offsetParent).map((b) => b.textContent?.trim()).filter(Boolean).slice(0, 14);
    return { vids, banner, buttons };
  });
  console.log(`[${Math.round((Date.now() - t0) / 1000)}s] videos=${JSON.stringify(s.vids)} banner=${JSON.stringify(s.banner)}`);
  if (i === 0 || i === 11) console.log(`   buttons: ${s.buttons.join(" | ")}`);
  await page.waitForTimeout(5000);
}
await browser.close();
