/**
 * dev-meeting-shots.ts — DEV ONLY, throwaway. Photograph the whole-meeting Analysis block and
 * the Sessions event pane for one account, phone and desktop, so a chart change can be judged
 * by eye rather than by "it compiles".
 *
 *   npx tsx scripts/dev-meeting-shots.ts --email=<account> [--base=http://localhost:3000] [--out=dir]
 *
 * Signs in through `/api/auth/dev-signin` (dev-only route, real cookie) — no DB access here.
 */
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";

const args = process.argv.slice(2);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const BASE = (argValue("base") ?? "http://localhost:3000").trim().replace(/\/$/, "");
const EMAIL = argValue("email");
const OUT = argValue("out") ?? "meeting-shots";
if (!EMAIL) throw new Error("--email=<account> is required");

async function settle(page: Page, ms = 1200) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
}

async function shoot(width: number, height: number, tag: string) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`  [${tag} console error]`, m.text().slice(0, 300));
  });

  const signIn = `${BASE}/api/auth/dev-signin?${new URLSearchParams({ email: EMAIL!, to: "/analysis" })}`;
  await page.goto(signIn, { waitUntil: "domcontentloaded" });
  await settle(page);
  console.log(`  [${tag}] landed on ${page.url()}`);

  await page.screenshot({ path: `${OUT}/${tag}-01-analysis-fold.png` });
  await page.screenshot({ path: `${OUT}/${tag}-02-analysis-full.png`, fullPage: true });

  const more = page.getByRole("button", { name: /[0-9]+ more/i });
  if ((await more.count()) > 0) {
    await more.first().click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${tag}-03-analysis-unfolded.png`, fullPage: true });
  }
  const dividers = await page.locator('[role="separator"][aria-label]').allInnerTexts();
  console.log(`  [${tag}] day dividers on /analysis:`, dividers.join(" | ") || "(none)");
  const heading = await page.locator("h2").first().innerText().catch(() => "?");
  console.log(`  [${tag}] heading:`, heading.replace(/\s+/g, " "));

  // Sessions: open the newest session.
  await page.goto(`${BASE}/runs/history`, { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.screenshot({ path: `${OUT}/${tag}-04-sessions-list.png` });
  const session = page.locator("button", { hasText: /run/i }).first();
  if ((await session.count()) > 0) {
    await session.click().catch(() => {});
    await settle(page, 1400);
    await page.screenshot({ path: `${OUT}/${tag}-05-sessions-meeting.png`, fullPage: true });
  } else {
    console.log(`  [${tag}] !! no session button on /runs/history`);
  }

  await browser.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log("→ phone 390×844");
  await shoot(390, 844, "phone");
  console.log("→ desktop 1440×900");
  await shoot(1440, 900, "desktop");
  console.log(`\nShots in ${OUT}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
