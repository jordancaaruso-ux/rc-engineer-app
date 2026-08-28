/**
 * dev-verdict-preview-shots.ts — DEV ONLY, throwaway. Shoots every state of the phone
 * day-verdict card off /debug/day-verdict-preview, one PNG per card at 390px, so the
 * 2026-08-25 anchor change can be read rather than reasoned about.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-verdict-preview-shots.ts --base=http://localhost:3000
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { prisma } from "@/lib/prisma";

const args = process.argv.slice(2);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const BASE = (argValue("base") ?? "http://localhost:3000").trim().replace(/\/$/, "");
const EMAIL = argValue("email") ?? "jordancaaruso@gmail.com";
const OUT = argValue("out") ?? "verdict-preview-shots";

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
  const ctx = await browser.newContext({ viewport: { width: 430, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("  [console error]", m.text().slice(0, 200));
  });

  await page.goto(await mintSignInUrl(EMAIL), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.goto(`${BASE}/debug/day-verdict-preview`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  // The bottom dock is fixed, so an element screenshot of a card near the fold comes back
  // with the nav painted over the handling row — the row this script exists to look at.
  await page.addStyleTag({ content: "nav, [class*='fixed'][class*='bottom-0'] { display: none !important; }" });
  await page.waitForTimeout(300);

  const cards = page.locator("div.flex-none[style*='390']");
  const count = await cards.count();
  console.log("states rendered:", count);

  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const title = (await card.locator("div.font-semibold").first().innerText()).trim();
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(120);
    await card.screenshot({ path: `${OUT}/${String(i + 1).padStart(2, "0")}-${slug}.png` });
    // Every visible line of the card, so the copy can be read without the picture.
    console.log(`${String(i + 1).padStart(2, "0")} ${title}`);
    console.log("   " + (await card.locator("[class*='SurfaceCard'], > div").last().innerText()).replace(/\n/g, " | "));
  }

  await page.screenshot({ path: `${OUT}/00-all.png`, fullPage: true });
  await browser.close();
  await prisma.$disconnect();
  console.log("shots in", OUT);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
