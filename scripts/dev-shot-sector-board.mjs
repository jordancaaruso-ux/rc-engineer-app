// Dev only: open a job's Done step (the sector board), screenshot it at rest, after a sector
// cell tap, and with the overlay off.
//   JOB=<id> VIDEO_PATH=<file> SHOT_DIR=<dir> [W=1440] node scripts/dev-shot-sector-board.mjs
import { chromium } from "@playwright/test";
const BASE = "http://localhost:3000";
const JOB = process.env.JOB;
const VIDEO = process.env.VIDEO_PATH;
const OUT = process.env.SHOT_DIR;
const W = Number(process.env.W ?? 1440);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: W, height: W < 600 ? 844 : 950 } });
page.on("console", (m) => { if (m.type() === "error") console.log("  [err]", m.text().slice(0, 200)); });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
await page.goto(`${BASE}/api/auth/dev-signin?email=jordancaaruso@gmail.com`, { waitUntil: "domcontentloaded" });
await page.goto(`${BASE}/videos/analysis/jobs/${JOB}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
if (VIDEO) { await page.locator('input[type="file"]').first().setInputFiles(VIDEO, { timeout: 15000 }); await page.waitForTimeout(2500); }
await page.locator("button:visible", { hasText: /^Done$/ }).first().click({ timeout: 10000 });
await page.waitForTimeout(5000);
await page.screenshot({ path: `${OUT}/board-${W}-rest.png`, fullPage: true });
const cells = page.locator("table td button:enabled");
console.log("cells:", await cells.count());
await cells.nth(2).click({ timeout: 10000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/board-${W}-tap.png`, fullPage: true });
await page.locator("button", { hasText: /^None/ }).first().click({ timeout: 10000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/board-${W}-none.png`, fullPage: true });
const text = await page.locator("body").innerText();
const i = text.indexOf("Solid");
console.log(text.slice(Math.max(0, i - 40), i + 700).replace(/\n+/g, " | "));
await browser.close();
