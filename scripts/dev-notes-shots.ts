/**
 * dev-notes-shots.ts — DEV ONLY, throwaway. Drive the four surfaces the markup notes landed on
 * and prove the changes actually work in a browser, not just in tsc:
 *
 *   - /paddock  car cards read "N runs / added <date>", tracks band says "No favourites yet"
 *   - /tracks   every row has a star; tapping one fills it and it survives a reload
 *   - /cars     back arrow present (phone + desktop)
 *   - /events   back arrow present (phone + desktop)
 *
 * Same sign-in scheme as dev-dash-shot.ts.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-notes-shots.ts --email=you@example.com
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
const OUT = argValue("out") ?? "notes-shots";

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

  const report: Record<string, unknown> = {};

  // ── /paddock ──────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/paddock`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/1-paddock-phone.png`, fullPage: true });
  report.paddockCarFigures = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href^='/cars/']"))
      .map((a) => (a.textContent || "").replace(/\s+/g, " ").trim())
      .filter((t) => /run|added/i.test(t))
      .slice(0, 4)
  );
  report.paddockTracksBand = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll("p")).find((p) =>
      /favourite|starred/i.test(p.textContent || "")
    );
    return el ? (el.textContent || "").trim() : "(no empty-state line — band has rows)";
  });

  // ── /tracks: the star must be a real control ──────────────────────────────
  await page.goto(`${BASE}/tracks`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/2-tracks-phone.png`, fullPage: true });

  const starButtons = page.locator('button[aria-label*="favourites"]');
  report.starButtonCount = await starButtons.count();
  const first = starButtons.first();
  report.starBefore = {
    label: await first.getAttribute("aria-label"),
    pressed: await first.getAttribute("aria-pressed"),
  };
  const firstTrackName = (await first.getAttribute("aria-label"))
    ?.replace(/^(Add|Remove) /, "")
    .replace(/ (to|from) favourites$/, "");
  await first.click();
  await page.waitForTimeout(1200);
  report.starAfterTap = {
    label: await first.getAttribute("aria-label"),
    pressed: await first.getAttribute("aria-pressed"),
  };
  await page.screenshot({ path: `${OUT}/3-tracks-starred.png`, fullPage: true });

  // Reload: did it actually persist, or was it only optimistic paint?
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  report.starAfterReload = await page.evaluate((name) => {
    const b = Array.from(document.querySelectorAll("button[aria-label]")).find((el) =>
      (el.getAttribute("aria-label") || "").includes(String(name))
    );
    return b ? { label: b.getAttribute("aria-label"), pressed: b.getAttribute("aria-pressed") } : null;
  }, firstTrackName);

  // ── Paddock band should now list it ───────────────────────────────────────
  await page.goto(`${BASE}/paddock`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  report.paddockBandAfterStar = await page.evaluate(() => {
    const band = Array.from(document.querySelectorAll("a[href^='/tracks']"))
      .map((a) => (a.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    return band.slice(0, 6);
  });
  await page.screenshot({ path: `${OUT}/4-paddock-after-star.png`, fullPage: true });

  // ── The deep link the band uses ───────────────────────────────────────────
  const bandTrackHref = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll("a[href*='/tracks?trackId=']"))[0];
    return a ? a.getAttribute("href") : null;
  });
  report.bandTrackHref = bandTrackHref;
  if (bandTrackHref) {
    await page.goto(`${BASE}${bandTrackHref}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    report.deepLinkExpandedRow = await page.evaluate(() => {
      const open = document.querySelector('button[aria-expanded="true"]');
      return open ? (open.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60) : null;
    });
    await page.screenshot({ path: `${OUT}/5-tracks-deeplink.png`, fullPage: true });
  }

  // ── Put the star back exactly as it was ───────────────────────────────────
  await page.goto(`${BASE}/tracks`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const restore = page.locator('button[aria-label*="favourites"]').first();
  await restore.click();
  await page.waitForTimeout(1200);
  report.starRestored = {
    label: await restore.getAttribute("aria-label"),
    pressed: await restore.getAttribute("aria-pressed"),
  };

  // ── Back arrows ───────────────────────────────────────────────────────────
  for (const [route, file] of [
    ["/cars", "6-cars-phone"],
    ["/events", "7-events-phone"],
  ] as const) {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    report[`back_${route}_phone`] = await page.evaluate(() => {
      const inHeader = document.querySelector('.page-header a[aria-label="Back"]');
      const pill = document.querySelector('a[aria-label="Back"]');
      return {
        headerArrow: inHeader ? inHeader.getAttribute("href") : null,
        anyBackControl: pill ? pill.getAttribute("href") : null,
      };
    });
    await page.screenshot({ path: `${OUT}/${file}.png` });
  }

  // Desktop: `is-echo` hides the title from md up — the arrow must survive that.
  // Same page, resized: the verification token is single use, so a second browser
  // context lands on /login and every assertion comes back a very convincing null.
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [route, file] of [
    ["/cars", "8-cars-desktop"],
    ["/events", "9-events-desktop"],
  ] as const) {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    report[`back_${route}_desktop`] = await page.evaluate(() => {
      const a = document.querySelector('.page-header a[aria-label="Back"]');
      if (!a) return { found: false, url: location.pathname };
      const r = a.getBoundingClientRect();
      const title = document.querySelector(".page-title");
      const tr = title ? title.getBoundingClientRect() : null;
      return {
        found: true,
        href: a.getAttribute("href"),
        visible: r.width > 0 && r.height > 0,
        left: Math.round(r.left),
        titleCollapsed: tr ? tr.width <= 2 : null,
      };
    });
    await page.screenshot({ path: `${OUT}/${file}.png` });
  }

  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
