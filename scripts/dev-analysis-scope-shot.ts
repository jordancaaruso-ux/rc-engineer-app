/**
 * dev-analysis-scope-shot.ts — DEV ONLY, throwaway. Prove the 2026-08-20 pin on `/analysis`:
 * the Session-trend card now names what it is charting, and every Recent-runs row names its track.
 *
 * Same sign-in scheme as dev-paddock-cars-shot.ts.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-analysis-scope-shot.ts --email=you@example.com
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
const OUT = argValue("out") ?? "analysis-scope-shots";

/** Handed to evaluate() as a STRING — tsx's `__name` helper does not exist inside the page. */
const PROBE = `(() => {
  const text = (el) => (el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : null);
  const all = Array.from(document.querySelectorAll('*'));
  const leaf = (want) =>
    all.find((el) => el.children.length === 0 && (el.textContent || '').trim().toLowerCase() === want);

  // Trend card: the scope line is the .type-timestamp inside the same .eyebrow-root as the title.
  const trendLabel = leaf('session trend');
  const trendHead = trendLabel ? trendLabel.closest('.eyebrow-root') : null;
  const scopeLine = trendHead ? trendHead.querySelector('.type-timestamp') : null;

  // Recent runs: every row is a link into a run.
  const rows = Array.from(document.querySelectorAll("a[href^='/runs/']")).filter(
    (a) => !/\\/runs\\/(new|history)/.test(a.getAttribute('href') || '')
  );

  return {
    trendScope: text(scopeLine),
    trendScopeTruncated: scopeLine ? scopeLine.scrollWidth > scopeLine.clientWidth + 1 : null,
    runRows: rows.map((a) => {
      const sub = a.querySelector('.type-timestamp');
      return {
        text: text(a).slice(0, 110),
        sub: text(sub),
        subTruncated: sub ? sub.scrollWidth > sub.clientWidth + 1 : null,
      };
    }),
    cleanLapsStillOnRows: rows.some((a) => /clean lap/i.test(a.textContent || '')),

    // Teammates card: which rows became doors, and where they point. Only a driver you share a
    // team with should be a link — everyone else is a readout.
    teammates: (() => {
      const head = leaf('teammates');
      const card = head ? head.closest("section, div[class*='rounded']") : null;
      if (!card) return null;
      const bodyRows = Array.from(card.querySelectorAll('a, .flex.items-center.gap-3')).filter(
        (el) => /\\d\\.\\d{3}/.test(el.textContent || '')
      );
      return bodyRows.map((el) => ({
        text: text(el),
        isLink: el.tagName === 'A',
        href: el.getAttribute ? el.getAttribute('href') : null,
        hasChevron: !!el.querySelector('svg'),
      }));
    })(),
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
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  await page.goto(signInUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  await page.goto(`${BASE}/analysis`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/analysis-390.png`, fullPage: true });

  console.log(JSON.stringify(await page.evaluate(PROBE), null, 2));

  /**
   * The truncation question this pass actually turns on: a long venue name will overrun the row,
   * so WHICH half survives? Track sits first precisely so the clock time is what gets eaten —
   * a row that says the venue and half the time still tells you the thing you came for.
   * Swap a long name in and re-measure rather than argue about it from character counts.
   */
  const LONG = "Sydney International Raceway";
  console.log(
    JSON.stringify(
      await page.evaluate(`(() => {
        const rows = Array.from(document.querySelectorAll("a[href^='/runs/']")).filter(
          (a) => !/\\/runs\\/(new|history)/.test(a.getAttribute('href') || '')
        );
        const sub = rows[0] ? rows[0].querySelector('.type-timestamp') : null;
        if (!sub) return { ran: false };
        sub.textContent = sub.textContent.replace(/^[^·]+/, ${JSON.stringify(LONG + " ")});
        return {
          ran: true,
          full: sub.textContent,
          clipped: sub.scrollWidth > sub.clientWidth + 1,
          visibleWidth: sub.clientWidth,
          neededWidth: sub.scrollWidth,
        };
      })()`),
      null,
      2
    )
  );
  await page.screenshot({ path: `${OUT}/analysis-390-long-track.png`, fullPage: false });

  await browser.close();
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
