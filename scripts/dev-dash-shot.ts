/**
 * dev-dash-shot.ts — DEV ONLY, throwaway. Capture the dashboard at desktop width AND measure the
 * two columns, so "the right column leaks past the bottom" can be looked at as a number instead of
 * argued about. Same sign-in scheme as dev-desktop-shots.ts.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-dash-shot.ts --email=you@example.com --width=1440 --height=900
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { prisma } from "@/lib/prisma";

const args = process.argv.slice(2);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const BASE = (process.env.AUTH_URL ?? "http://localhost:3000").trim().replace(/\/$/, "");
const WIDTH = Number(argValue("width") ?? 1440);
const HEIGHT = Number(argValue("height") ?? 900);
const EMAIL = argValue("email") ?? "jordancaaruso@gmail.com";
const OUT = argValue("out") ?? "desktop-shots/dash";

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

const MEASURE = `(() => {
  const grid = document.querySelector('.page-body .xl\\\\:grid') ||
    Array.from(document.querySelectorAll('.page-body > div')).find(function (d) {
      return getComputedStyle(d).display === 'grid';
    });
  if (!grid) return { error: 'no grid found' };
  const cols = Array.from(grid.children);
  const out = { viewportHeight: window.innerHeight, docHeight: document.documentElement.scrollHeight, columns: [] };
  for (const col of cols) {
    const r = col.getBoundingClientRect();
    out.columns.push({
      width: Math.round(r.width),
      height: Math.round(r.height),
      top: Math.round(r.top + window.scrollY),
      bottom: Math.round(r.bottom + window.scrollY),
      cards: Array.from(col.children).map(function (c) {
        const cr = c.getBoundingClientRect();
        const label = (c.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 46);
        return { height: Math.round(cr.height), top: Math.round(cr.top + window.scrollY), label: label };
      }),
    });
  }
  return out;
})()`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const signInUrl = await mintSignInUrl(EMAIL);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
  });
  const page = await context.newPage();

  await page.goto(signInUrl, { waitUntil: "networkidle" });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: `${OUT}/dashboard-viewport.png`, fullPage: false });
  await page.screenshot({ path: `${OUT}/dashboard-full.png`, fullPage: true });

  const measured = await page.evaluate(MEASURE);
  console.log(JSON.stringify(measured, null, 2));

  await browser.close();
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
