/**
 * dev-trend-extras-shots.ts — DEV ONLY, throwaway. Look at the session-trend
 * readout's two new figures (rating + air) on REAL runs, in both shapes:
 * the compact strip at 390px and the full card's cells at 1440px.
 *
 * Proves what a typecheck cannot: that six figures still fit on one line of a
 * phone without wrapping, and that the rating numeral picks up its band ink.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-trend-extras-shots.ts --base=http://localhost:3000
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";

const args = process.argv.slice(2);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const BASE = (argValue("base") ?? process.env.AUTH_URL ?? "http://localhost:3000")
  .trim()
  .replace(/\/$/, "");
const EMAIL = argValue("email") ?? "jordancaaruso@gmail.com";
const OUT = argValue("out") ?? "trend-extras-shots";

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

/**
 * The plot is simply the biggest SVG on the page — asking for `svg` first lands on a
 * nav glyph, which is how the first run of this script hovered nothing and reported
 * the same run three times.
 */
async function plotBox(page: Page) {
  return page.evaluate(() => {
    let best: DOMRect | null = null;
    for (const svg of Array.from(document.querySelectorAll("svg"))) {
      const r = svg.getBoundingClientRect();
      if (r.width < 120 || r.height < 80) continue;
      if (!best || r.width * r.height > best.width * best.height) best = r;
    }
    return best ? { x: best.x, y: best.y, width: best.width, height: best.height } : null;
  });
}

/** The strip walks itself; hovering a column stops the walk and pins one run. */
async function pinColumn(page: Page, fraction: number) {
  const box = await plotBox(page);
  if (!box) return;
  await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2);
  await page.waitForTimeout(400);
}

/**
 * The readout line, read back as text so each shot has a witness — the figures moved
 * up to the caption, so this reads the line the run's name is on.
 */
async function readCaption(page: Page): Promise<string> {
  const line = page.locator("text=/Rating\\s*\\d/").first();
  if ((await line.count()) === 0) return "(no rating in any readout)";
  const row = line.locator("xpath=ancestor::*[self::div][1]");
  return (await row.innerText()).replace(/\s+/g, " ").trim();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await phone.newPage();
  await page.goto(await mintSignInUrl(EMAIL), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  await page.goto(`${BASE}/analysis`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);

  for (const [name, fraction] of [
    ["a", 0.08],
    ["b", 0.5],
    ["c", 0.92],
  ] as const) {
    await pinColumn(page, fraction);
    console.log(`phone readout ${name}: ${await readCaption(page)}`);
    await page.screenshot({ path: `${OUT}/phone-analysis-${name}.png` });
  }

  // Whether the row wrapped is the whole question at 390px, so measure it rather
  // than squinting at the picture: one line of figures, or two.
  const stripBox = await page
    .locator("[role='group'][aria-label='Metrics']")
    .first()
    .boundingBox();
  console.log(`phone strip box: ${JSON.stringify(stripBox)}`);

  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 2,
    storageState: await phone.storageState(),
  });
  const wide = await desktop.newPage();
  await wide.goto(`${BASE}/runs/history`, { waitUntil: "domcontentloaded" });
  await wide.waitForTimeout(5000);
  await pinColumn(wide, 0.5);
  console.log(`desktop readout: ${await readCaption(wide)}`);
  await wide.screenshot({ path: `${OUT}/desktop-history.png` });

  await browser.close();
  await prisma.$disconnect();
  console.log(`shots in ${OUT}/`);
}

void main();
