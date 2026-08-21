/**
 * dev-paddock-cars-shot.ts — DEV ONLY, throwaway. Prove the founder's `/paddock` pin in a browser:
 * the expanded car carries no "N runs / added <date>" figures any more, and its name renders at the
 * same size as the compact car rows below it.
 *
 * Same sign-in scheme as dev-notes-shots.ts.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-paddock-cars-shot.ts --email=you@example.com
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
const OUT = argValue("out") ?? "paddock-cars-shots";

/**
 * esbuild (through tsx) rewrites named functions with a `__name` helper that does not exist inside
 * the page, so the probe is handed to evaluate() as a STRING rather than as a closure.
 */
const PROBE = `(() => {
  const all = Array.from(document.querySelectorAll('*'));
  const header = all.find(
    (el) => el.children.length === 0 && (el.textContent || '').trim().toLowerCase() === 'cars'
  );
  const card = header ? header.closest("section, div[class*='rounded']") : null;
  const rows = Array.from((card || document).querySelectorAll("a[href^='/cars/']"));
  const face = (el) =>
    el ? getComputedStyle(el).fontSize + ' / ' + getComputedStyle(el).fontWeight : null;
  return {
    carRowText: rows.map((a) => (a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 90)),
    figuresStillOnPage: rows.some((a) => /\\badded\\b/i.test(a.textContent || '')),
    leadNameFace: rows[0] ? face(rows[0].querySelector('p')) : null,
    compactNameFaces: rows.slice(1).map((a) => face(a.querySelector('span'))),
  };
})()`;

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

  await page.goto(signInUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  await page.goto(`${BASE}/paddock`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/paddock-phone.png`, fullPage: true });

  const report = await page.evaluate(PROBE);
  console.log(JSON.stringify(report, null, 2));

  await browser.close();
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
