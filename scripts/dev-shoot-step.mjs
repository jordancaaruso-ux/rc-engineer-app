/**
 * Dev only: screenshot one step of the analyze flow on a job, desktop and phone, headless.
 *
 *   JOB=<jobId> VIDEO_PATH=<file> SHOT_DIR=<dir> node scripts/dev-shoot-step.mjs [Sync|Mark|Lines]
 *
 * Prints the step's text too, so the copy can be checked without opening the pictures.
 */
import { chromium } from "@playwright/test";
const BASE = "http://localhost:3000";
const JOB = process.env.JOB;
const VIDEO = process.env.VIDEO_PATH;
const OUT = process.env.SHOT_DIR;
const STEP = process.argv[2] ?? "Sync";

const browser = await chromium.launch({ channel: "msedge", headless: true });
process.on("uncaughtException", async (e) => { console.error(e?.message ?? e); try { await browser.close(); } catch {} process.exit(1); });
try {
  for (const [name, viewport] of [["desktop", { width: 1280, height: 950 }], ["phone", { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    await page.goto(`${BASE}/api/auth/dev-signin?email=jordancaaruso@gmail.com`, { waitUntil: "domcontentloaded" });
    await page.goto(`${BASE}/videos/analysis/jobs/${JOB}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.locator('input[type="file"]').first().setInputFiles(VIDEO);
    await page.waitForTimeout(1500);
    await page.locator("button:visible", { hasText: new RegExp(`^${STEP}$`) }).first().click({ timeout: 20000 });
    await page.waitForFunction(() => { const v = document.querySelector("video"); return !!v && v.readyState >= 1; }, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${STEP.toLowerCase()}-${name}.png`, fullPage: name === "phone" });
    const text = await page.locator("body").innerText();
    const i = text.indexOf(STEP === "Sync" ? "Sync the laps" : STEP);
    console.log(`--- ${name} ---\n` + text.slice(Math.max(0, i), i + 700));
    await page.close();
  }
} finally {
  await browser.close();
}
