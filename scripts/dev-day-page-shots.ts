/**
 * dev-day-page-shots.ts — DEV ONLY, throwaway. Drive the rebuilt day screen on
 * REAL data: the 19 Jul 2026 TFTR test day, five runs.
 *
 * Proves what a typecheck cannot: the row's wrench actually raises the setup
 * sheet, the expansion draws real laps, and the row's figures line up under the
 * headings now that a button shares the row with them.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-day-page-shots.ts --base=http://localhost:3005
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { prisma } from "@/lib/prisma";

const args = process.argv.slice(2);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const BASE = (argValue("base") ?? process.env.AUTH_URL ?? "http://localhost:3000")
  .trim()
  .replace(/\/$/, "");
const EMAIL = argValue("email") ?? "jordancaaruso@gmail.com";
const OUT = argValue("out") ?? "day-page-shots";
/** The day from the founder's own screenshot. */
const GROUP = argValue("group") ?? "day-2026-07-19-name:tftr";

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
  });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("  [console error]", m.text().slice(0, 200));
  });
  page.on("requestfailed", (r) => console.log("  [request failed]", r.url().slice(0, 120)));

  await page.goto(await mintSignInUrl(EMAIL), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  await page.goto(`${BASE}/runs/history?g=${encodeURIComponent(GROUP)}`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/01-day.png`, fullPage: true });
  console.log("rows:", await page.getByRole("button", { expanded: false }).count());

  // Right edges of the headings vs the figures under them — a button sharing the
  // row is exactly the change that knocks a column out of line.
  // A string, not a closure: tsx compiles arrow functions with a `__name` helper
  // that does not exist inside the page.
  const cols = await page.evaluate(`(() => {
    var r = function (el) { return el ? Math.round(el.getBoundingClientRect().right) : null; };
    var head = document.querySelectorAll('div.bg-muted\\\\/40 > span');
    var figs = document.querySelectorAll('button[aria-expanded] > span[class*="w-[5"]');
    return {
      bestHead: r(head[1]), top10Head: r(head[2]),
      bestFig: r(figs[0]), top10Fig: r(figs[1]),
    };
  })()`);
  console.log("column right edges (heading vs figure):", cols);

  // Open a run.
  await page.getByRole("button", { expanded: false }).nth(1).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/02-open.png`, fullPage: true });

  // The wrench: does it raise the setup sheet?
  const wrench = page.getByRole("button", { name: /View setup sheet for/i }).first();
  console.log("wrench buttons:", await page.getByRole("button", { name: /View setup sheet for/i }).count());
  await page.evaluate("window.scrollTo(0, 0)");
  await wrench.click();
  await page.waitForTimeout(2500);
  const dialog = await page.getByRole("dialog").count();
  console.log("setup sheet open?", dialog > 0);
  await page.screenshot({ path: `${OUT}/03-setup-sheet.png` });

  await browser.close();
  await prisma.$disconnect();
  console.log(`shots in ${OUT}/`);
}

void main();
