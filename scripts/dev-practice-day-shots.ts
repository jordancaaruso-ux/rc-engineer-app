/**
 * dev-practice-day-shots.ts — DEV ONLY, throwaway. Drives the day seeded by
 * `dev-seed-practice-day.ts`: the dashboard's Today card, the Sessions day and its run rows,
 * and the fabricated states on /debug/day-verdict-preview.
 *
 *   npx tsx scripts/dev-practice-day-shots.ts --base=http://localhost:3005 --out=shots
 */
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const argValue = (n: string) =>
  args.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const BASE = (argValue("base") ?? "http://localhost:3005").replace(/\/$/, "");
const OUT = argValue("out") ?? "practice-day-shots";

const flat = (s: string) => s.replace(/\n+/g, " | ");

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { signInUrl } = JSON.parse(readFileSync("e2e/.auth/practice-day.json", "utf8"));

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 900 },
    deviceScaleFactor: 2,
    timezoneId: "Australia/Melbourne",
    locale: "en-AU",
  });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("  [console error]", m.text().slice(0, 180));
  });

  console.log("sign in…");
  await page.goto(signInUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  console.log("dashboard…");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: "networkidle" }); // second load: the rc_tz cookie is set
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/01-dashboard.png`, fullPage: true });
  const pace = page.locator("text=/Best (run )?was/").first();
  console.log("  PACE LINE:", (await pace.count()) ? (await pace.textContent())?.trim() : "not found");

  console.log("sessions…");
  await page.goto(`${BASE}/runs/history?expandLatest=1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/02-sessions.png`, fullPage: true });

  const day = page.locator("text=Kilsyth Raceway").first();
  if (await day.count()) {
    await day.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${OUT}/02b-sessions-day.png`, fullPage: true });
    console.log("  DAY:", flat(await page.locator("body").innerText()).slice(0, 1100));
  }

  console.log("analysis…");
  await page.goto(`${BASE}/analysis`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/04-analysis.png`, fullPage: true });

  console.log("verdict preview…");
  await page.setViewportSize({ width: 430, height: 1200 });
  await page.goto(`${BASE}/debug/day-verdict-preview`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/03-verdict-preview.png`, fullPage: true });

  await browser.close();
  console.log(`\nShots in ${OUT}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
