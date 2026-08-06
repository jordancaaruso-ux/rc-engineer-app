/**
 * dev-desktop-shots.ts — DEV ONLY. Capture the app at desktop width.
 *
 *   npm run shots:desktop                 # 1440x900, the review width
 *   npm run shots:desktop -- --width=2560 --tag=ultrawide
 *   npm run shots:desktop -- --email=demo@jrcdynamics.com
 *
 * Why this exists: `playwright.config.ts` is 390x844 and nothing else, because the app was built
 * phone-first (docs/VISUAL_NORTH_STAR.md). That made desktop invisible — there was no way to LOOK
 * at what a 1440px viewer actually gets, so the layout drifted without anyone seeing it. Every
 * marketing capture in public/landing/assets is a phone shot for the same reason.
 *
 * Writes PNGs to desktop-shots/<tag>/. Signs in by minting a real magic-link token (same scheme as
 * dev-billing-states.ts), so it captures the true signed-in app, not a logged-out shell.
 *
 * Defaults to the DEMO account — anonymized, curated, and safe to put in front of anyone. Pass
 * --email to capture a different account.
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
const TAG = argValue("tag") ?? `${WIDTH}x${HEIGHT}`;
const EMAIL = argValue("email") ?? "demo@jrcdynamics.com";
const OUT = `desktop-shots/${TAG}`;

/** The screens a driver actually moves through, plus the two the founder wants for marketing. */
const ROUTES: Array<{ path: string; name: string }> = [
  { path: "/", name: "01-dashboard" },
  { path: "/engineer", name: "02-engineer" },
  { path: "/runs/history", name: "03-run-history" },
  { path: "/analysis", name: "04-analysis" },
  { path: "/cars", name: "05-garage" },
  { path: "/events", name: "06-events" },
  { path: "/settings", name: "07-settings" },
  { path: "/teams", name: "08-teams" },
];

async function mintSignInUrl(email: string): Promise<string> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set — run via npm so .env.local loads.");
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
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
// Desktop, so no touch and a real pointer — otherwise hover states and any
    // `@media (hover:hover)` rule capture in their mobile form on a desktop-sized viewport.
    hasTouch: false,
    isMobile: false,
  });
  const page = await context.newPage();

  await page.goto(signInUrl, { waitUntil: "networkidle" });
  console.log(`signed in as ${EMAIL} — capturing ${WIDTH}x${HEIGHT} into ${OUT}/`);

  for (const route of ROUTES) {
    try {
      await page.goto(`${BASE}${route.path}`, { waitUntil: "networkidle", timeout: 60_000 });
      // Let route transitions and any reveal animations settle before the shutter.
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}/${route.name}.png`, fullPage: false });
      console.log(`  ${route.name}  ${route.path}`);
    } catch (err) {
      console.log(`  SKIP ${route.name} (${route.path}) — ${err instanceof Error ? err.message.split("\n")[0] : err}`);
    }
  }

  await browser.close();
  await prisma.$disconnect();
  console.log(`\nDone. ${OUT}/`);
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
