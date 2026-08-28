// Dev only: open a job and screenshot a step. MODE=done (jump to Done) or MODE=lines (Lines →
// Edit lines → Save lines, to see the shared-set choice). VIDEO_PATH optional.
import { chromium } from "@playwright/test";
const BASE = "http://localhost:3000";
const JOB = process.env.JOB; const VIDEO = process.env.VIDEO_PATH; const OUT = process.env.SHOT_DIR; const MODE = process.env.MODE ?? "done";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.log("  [err]", m.text().slice(0, 200)); });
await page.goto(`${BASE}/api/auth/dev-signin?email=jordancaaruso@gmail.com`, { waitUntil: "domcontentloaded" });
await page.goto(`${BASE}/videos/analysis/jobs/${JOB}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
if (VIDEO) { await page.locator('input[type="file"]').first().setInputFiles(VIDEO, { timeout: 15000 }); await page.waitForTimeout(2500); }
const rail = (name) => page.locator("button:visible", { hasText: new RegExp(`^${name}$`) }).first();
if (MODE === "done") {
  console.log("Done rail enabled:", await rail("Done").isEnabled().catch(() => "n/a"));
  await rail("Done").click({ timeout: 10000 }).catch((e) => console.log("click failed", e.message));
  await page.waitForTimeout(5000);
} else {
  await rail("Lines").click({ timeout: 10000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /^Edit lines$/ }).first().click({ timeout: 10000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /^Save lines$/ }).first().click({ timeout: 10000 });
  await page.waitForTimeout(1200);
}
await page.screenshot({ path: `${OUT}/${MODE}-step.png`, fullPage: true });
const text = await page.locator("body").innerText();
const i = MODE === "done" ? text.indexOf("Done —") : text.indexOf("is also read by");
console.log(i >= 0 ? text.slice(i, i + 1200) : "marker not found:\n" + text.slice(0, 600));
await browser.close();
