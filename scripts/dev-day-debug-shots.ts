/**
 * dev-day-debug-shots.ts — DEV ONLY, throwaway. The rebuilt day screen on the
 * five-run fixture at /debug/session-trend, where the chart has something to draw
 * and the expansion has both faces of the setup diff (changed / unchanged).
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-day-debug-shots.ts --base=http://localhost:3005
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
const OUT = argValue("out") ?? "day-debug-shots";

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
  const signInUrl = await mintSignInUrl(EMAIL);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("  [console error]", m.text().slice(0, 200));
  });

  await page.goto(signInUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  await page.goto(`${BASE}/debug/session-trend`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/01-collapsed.png`, fullPage: true });

  const rows = page.getByRole("button", { expanded: false });
  console.log("collapsible rows:", await rows.count());

  // Row 1 (newest) — the fixture gives it a real diff.
  await rows.nth(0).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/02-one-open.png`, fullPage: true });

  // Row 2 as well, with the first still open: the comparison the doors prevented.
  await page.getByRole("button", { expanded: false }).nth(0).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/03-two-open.png`, fullPage: true });

  // Tapping a point on the chart must open its row here, not leave the page.
  const before = page.url();
  const openBefore = await page.getByRole("button", { expanded: true }).count();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const svg = page.locator("div.lg\\:hidden svg").first();
  const svgBox = await svg.boundingBox();
  console.log("chart box at click time:", svgBox);
  if (svgBox) {
    // Two taps: the first points at the run (readout / row tint), the second opens it.
    const x = svgBox.x + svgBox.width * 0.28;
    const y = svgBox.y + svgBox.height * 0.5;
    await page.mouse.click(x, y);
    await page.waitForTimeout(300);
    await page.mouse.click(x, y);
    await page.waitForTimeout(900);
  }
  console.log("chart tap — navigated away?", page.url() !== before);
  console.log("open rows before/after chart tap:", openBefore, "→", await page.getByRole("button", { expanded: true }).count());
  await page.screenshot({ path: `${OUT}/05-chart-tap.png`, fullPage: true });

  // How tall the card is now, measured rather than eyeballed.
  const chart = page.locator("div.lg\\:hidden svg").first();
  const box = await chart.boundingBox();
  console.log("compact chart svg box:", box);

  // The error path: these fixture ids are not real runs, so the setup fetch 404s
  // and the row must say so rather than doing nothing.
  await page.evaluate("window.scrollTo(0, 0)");
  await page.getByRole("button", { name: /View setup sheet for/i }).first().click();
  await page.waitForTimeout(1500);
  console.log(
    "setup error shown?",
    await page.getByText("Couldn't load the setup for this run.").count()
  );
  await page.screenshot({ path: `${OUT}/06-setup-error.png`, fullPage: true });

  const wide = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const deskPage = await wide.newPage();
  // A magic link is single-use — the phone context already spent the first one.
  await deskPage.goto(await mintSignInUrl(EMAIL), { waitUntil: "domcontentloaded" });
  await deskPage.waitForTimeout(1000);
  await deskPage.goto(`${BASE}/debug/session-trend`, { waitUntil: "networkidle" });
  await deskPage.waitForTimeout(1200);
  await deskPage.screenshot({ path: `${OUT}/04-desktop.png` });

  await browser.close();
  await prisma.$disconnect();
  console.log(`shots in ${OUT}/`);
}

void main();
