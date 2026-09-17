/**
 * dev-import-range-shots.ts — DEV ONLY, throwaway. Drive "Import your last runs" on a phone-sized
 * viewport: open the sheet, check it fits, pick a range on the calendar, and watch the per-day
 * progress line. Same sign-in scheme as dev-dash-shot.ts.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-import-range-shots.ts --email=you@example.com
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { prisma } from "@/lib/prisma";

const args = process.argv.slice(2);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const BASE = (argValue("base") ?? "http://localhost:3000").replace(/\/$/, "");
const EMAIL = argValue("email") ?? "jordancaaruso@gmail.com";
const OUT = argValue("out") ?? "import-range-shots";
/** Two midweek days: the loop runs end to end without filing anything into the dev database. */
const FROM_DAY = Number(argValue("from") ?? 9);
const TO_DAY = Number(argValue("to") ?? 10);
const PRESS = args.includes("--press");

async function mintSignInUrl(email: string): Promise<string> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set — run via dotenv-cli so .env.local loads.");
  const user = await prisma.user.findFirst({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`No user ${email} in this database.`);
  const token = randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: {
      identifier: email,
      token: createHash("sha256").update(`${token}${secret}`).digest("hex"),
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  const params = new URLSearchParams({ callbackUrl: `${BASE}/`, token, email });
  return `${BASE}/api/auth/callback/nodemailer?${params}`;
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

  await page.goto(await mintSignInUrl(EMAIL), { waitUntil: "domcontentloaded" });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });

  const row = page.getByRole("button", { name: "Import your last runs" });
  await row.waitFor({ state: "visible", timeout: 30_000 });
  await row.click();

  const sheet = page.getByRole("dialog", { name: "Import your last runs" });
  await sheet.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/01-sheet-open.png` });

  const box = await sheet.boundingBox();
  const scroll = await sheet.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  console.log("sheet box:", box, "scroll:", scroll);

  const button = sheet.locator("button").last();
  console.log("button says:", (await button.innerText()).trim());

  // Two taps on the calendar: a range.
  const first = sheet.getByRole("button", { name: new RegExp(`^\\w+day, ${FROM_DAY} \\w+ 2026$`) });
  const second = sheet.getByRole("button", { name: new RegExp(`^\\w+day, ${TO_DAY} \\w+ 2026$`) });
  await first.click();
  await second.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/02-range-picked.png` });
  console.log("button now says:", (await button.innerText()).trim());

  // The oldest day the calendar offers, and the one before it.
  const reach = await sheet.evaluate(() => {
    const cells = Array.from(document.querySelectorAll("[role=dialog] button[aria-label*='2026']"));
    const live = cells.filter((c) => !(c as HTMLButtonElement).disabled);
    const dead = cells.filter((c) => (c as HTMLButtonElement).disabled);
    return {
      oldestPickable: live.at(-1)?.getAttribute("aria-label") ?? null,
      newestPickable: live.at(0)?.getAttribute("aria-label") ?? null,
      greyed: dead.length,
    };
  });
  console.log("reach:", reach);

  if (PRESS) {
    await button.click();
    for (let i = 0; i < 40; i += 1) {
      await page.waitForTimeout(1000);
      const label = (await button.innerText().catch(() => "")).trim();
      console.log(`  t+${i + 1}s: ${label || "(gone)"}`);
      if (i === 1) await page.screenshot({ path: `${OUT}/03-progress.png` });
      if (!label) break;
      if (!/^Day |Looking/.test(label)) break;
    }
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/04-after.png` });
    const status = await page.locator("[role=status]").innerText().catch(() => "(none)");
    console.log("status line:", status);
    console.log("landed on:", page.url());
  }

  await browser.close();
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
