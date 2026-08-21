/**
 * dev-chevron-shots.ts — DEV ONLY, throwaway. Prove the Paddock rows now read as doors.
 *
 * Founder call: option B — every navigating row takes a "this opens" mark, and a setup steps in
 * under its car with a smaller, fainter one. This drives /paddock and asserts, per band, that
 * every <a> row actually contains an <svg> and how wide that svg is, because the whole risk in
 * a 12–16px mark is that it renders and nobody can see it.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-chevron-shots.ts --email=you@example.com
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { prisma } from "@/lib/prisma";

const args = process.argv.slice(2);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const BASE = (process.env.AUTH_URL ?? "http://localhost:3000").trim().replace(/\/$/, "");
const EMAIL = argValue("email") ?? "jordancaaruso@gmail.com";
const OUT = argValue("out") ?? "chevron-shots";

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
    viewport: { width: 430, height: 873 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("  [console error]", m.text().slice(0, 180));
  });

  await page.goto(signInUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  await page.goto(`${BASE}/paddock`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/paddock-phone.png`, fullPage: true });

  /* Walk the real cards. A row without an svg is a door with no handle — the whole point. */
  const audit = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("main a[href]"))
      .filter((a) => (a as HTMLElement).offsetParent !== null)
      .map((a) => {
        const el = a as HTMLAnchorElement;
        const svg = el.querySelector("svg:not([data-lucide-star])");
        const marks = Array.from(el.querySelectorAll("svg"));
        const r = el.getBoundingClientRect();
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        const last = marks[marks.length - 1];
        const lr = last ? last.getBoundingClientRect() : null;
        return {
          text: text.slice(0, 44),
          href: el.getAttribute("href"),
          hasMark: Boolean(svg),
          markPx: lr ? Math.round(lr.width) : null,
          markInk: last ? getComputedStyle(last).color : null,
          /* how far the mark sits from the row's right edge */
          gapRight: lr ? Math.round(r.right - lr.right) : null,
          paddingLeft: Math.round(parseFloat(getComputedStyle(el).paddingLeft)),
        };
      });
    return cards;
  });

  console.log(JSON.stringify(audit, null, 2));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/paddock`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/paddock-desktop.png`, fullPage: true });

  await browser.close();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
