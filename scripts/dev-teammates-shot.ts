/**
 * dev-teammates-shot.ts — DEV ONLY, throwaway. Scroll `/analysis` down to the two
 * "who else is out" cards and photograph them on real data.
 *
 * The full-page shot cannot show them: the bottom dock is `position: fixed`, so on a
 * full-page capture it lands in the middle of the image, right over these cards.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-teammates-shot.ts --base=http://localhost:3000
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
const OUT = argValue("out") ?? "teammates-shots";

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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(await mintSignInUrl(EMAIL), { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});

  await page.goto(`${BASE}/analysis`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);

  // Scroll the standing card to the top of the viewport, then shoot what is on screen.
  await page.evaluate(`(() => {
    const head = [...document.querySelectorAll('h2')].find(
      (el) => el.textContent && el.textContent.trim().toLowerCase() === 'out with you'
    );
    const card = head ? head.closest('[class*="rounded"]') : null;
    if (card) window.scrollTo({ top: window.scrollY + card.getBoundingClientRect().top - 12 });
  })()`);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/01-standing-and-roster.png` });

  // Expanded roster.
  const showAll = page.getByRole("button", { name: /show all/i });
  if ((await showAll.count()) > 0) {
    await showAll.first().click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/02-roster-expanded.png` });
  }

  console.log(`Shots in ${OUT}/`);
  await browser.close();
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
