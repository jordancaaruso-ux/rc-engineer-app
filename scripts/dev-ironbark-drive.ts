/**
 * dev-ironbark-drive.ts — DEV ONLY, throwaway. Drive "Import your last runs" over a RANGE on the
 * Ironbark demo account: sign in, pick a week, press, watch the per-day progress, answer
 * "Which car?", and report where it landed and what it filed.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-ironbark-drive.ts [--from=7] [--to=1]
 *
 * The dev server must be running with DEMO_TIMING_SITE=1.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { prisma } from "@/lib/prisma";

const args = process.argv.slice(2);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const BASE = "http://localhost:3000";
const EMAIL = "ironbark.demo@jrcdynamics.com";
const OUT = "import-range-shots/ironbark";
const FROM_DAYS_AGO = Number(argValue("from") ?? 7);
const TO_DAYS_AGO = Number(argValue("to") ?? 1);

/** "Wednesday, 9 September 2026" — the aria-label the calendar cells carry. */
function cellLabel(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12)));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    timezoneId: "Australia/Sydney",
  });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("  console error:", m.text());
  });

  await page.goto(`${BASE}/api/auth/dev-signin?email=${encodeURIComponent(EMAIL)}&to=/`, {
    waitUntil: "networkidle",
  });
  console.log("landed after sign-in:", page.url());

  const row = page.getByRole("button", { name: "Import your last runs" });
  await row.waitFor({ state: "visible", timeout: 30_000 });
  await row.click();

  const sheet = page.getByRole("dialog", { name: "Import your last runs" });
  await sheet.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/01-sheet.png` });

  const trackRows = await sheet.locator("ul").first().innerText();
  console.log("tracks offered:", JSON.stringify(trackRows.split("\n")));

  await sheet.getByRole("button", { name: cellLabel(FROM_DAYS_AGO) }).click();
  await page.waitForTimeout(250);
  await sheet.getByRole("button", { name: cellLabel(TO_DAYS_AGO) }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/02-range.png` });

  const button = sheet.locator("button").last();
  console.log("button says:", (await button.innerText()).trim());
  await button.click();

  let shotAt3 = false;
  for (let i = 0; i < 90; i += 1) {
    await page.waitForTimeout(1000);
    const label = (await button.innerText().catch(() => "")).trim();
    console.log(`  t+${i + 1}s: ${label || "(button gone)"}`);
    if (!shotAt3 && i >= 2) {
      await page.screenshot({ path: `${OUT}/03-progress.png` });
      shotAt3 = true;
    }
    if (!label || !/^Day |Looking/.test(label)) break;
  }

  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/04-after-import.png` });

  // "Which car?" — one question for the whole stretch.
  const carSheet = page.getByRole("dialog", { name: "Which car?" });
  if (await carSheet.isVisible().catch(() => false)) {
    const text = await carSheet.innerText();
    console.log("car question:\n" + text.split("\n").map((l) => "    " + l).join("\n"));
    await carSheet.getByRole("button", { name: /Ironbark buggy/ }).click();
    for (let i = 0; i < 60; i += 1) {
      await page.waitForTimeout(1000);
      if (!(await carSheet.isVisible().catch(() => false))) break;
      console.log(`  car t+${i + 1}s: still filing`);
    }
    await page.waitForTimeout(1500);
  } else {
    console.log("car question: not shown");
  }

  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  console.log("landed on:", page.url());
  await page.screenshot({ path: `${OUT}/05-landing.png` });
  const body = (await page.locator("body").innerText()).split("\n").slice(0, 26);
  console.log("page reads:\n" + body.map((l) => "    " + l).join("\n"));

  const user = await prisma.user.findFirst({ where: { email: EMAIL }, select: { id: true } });
  const runs = await prisma.run.findMany({
    where: { userId: user!.id },
    orderBy: { sortAt: "desc" },
    select: { sortAt: true, unconfirmedAt: true, carId: true, lapTimes: true },
  });
  console.log(`\nruns now on the account: ${runs.length}`);
  for (const r of runs) {
    const laps = Array.isArray(r.lapTimes) ? r.lapTimes.length : 0;
    console.log(
      `  ${r.sortAt.toISOString().slice(0, 16)}  laps ${laps}  car ${r.carId ? "yes" : "NONE"}  ${r.unconfirmedAt ? "unconfirmed" : "confirmed"}`,
    );
  }

  await browser.close();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
