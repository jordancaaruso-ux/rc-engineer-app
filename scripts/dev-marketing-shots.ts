/**
 * dev-marketing-shots.ts — DEV ONLY. Photograph the app for the website.
 *
 *   npm run shots:marketing                       # phone (iPhone 15 Pro, 3x) + desktop (1440, 2x)
 *   npm run shots:marketing -- --only=phone       # or --only=desktop
 *   npm run shots:marketing -- --pick=dashboard,engineer
 *
 * Why this exists: the pitch page's screenshots were 640px JPEGs of the old dark theme, taken by
 * hand and never re-taken. This shoots the SAME set of screens from the demo account every time,
 * at device density, as lossless PNGs, so the site can be re-shot in one command whenever the app
 * changes. Stage the demo as a race day first (`npm run demo:race-day`) — every screen assumes
 * runs logged today.
 *
 * What it hides, deliberately: the demo read-only banner, the Next.js dev badge, scrollbars, focus
 * rings, the text caret. Nothing else is faked; what you see is what a signed-in driver sees.
 *
 * Signs in through the dev-signin door, so it needs `next dev` on BASE (production refuses that
 * route). Writes to marketing-shots/<phone|desktop>/NN-name.png, plus a -full.png of the whole
 * page for phone screens where the fold matters.
 */
import { mkdirSync } from "node:fs";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { demoCatalogUserId } from "@/lib/demo/demoAccess";

const args = process.argv.slice(2);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const BASE = (process.env.SHOTS_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const EMAIL = argValue("email") ?? "demo@jrcdynamics.com";
const TIME_ZONE = "Australia/Melbourne";
const ONLY = argValue("only"); // phone | desktop
const PICK = argValue("pick")?.split(",").map((s) => s.trim()).filter(Boolean);
const OUT = "marketing-shots";

/** Everything a viewer should never see in a marketing shot. */
const HIDE_CSS = `
  [data-demo-banner], nextjs-portal { display: none !important; }
  *::-webkit-scrollbar { display: none !important; }
  * { scrollbar-width: none !important; caret-color: transparent !important; }
  *:focus, *:focus-visible { outline: none !important; box-shadow: none !important; }
`;

type Shot = {
  name: string;
  path: string;
  /** Anything to do on the page before the shutter: open a tab, click a row. */
  act?: (page: Page) => Promise<void>;
  /** Also save the whole page (phone only). */
  full?: boolean;
};

async function subjects() {
  const userId = demoCatalogUserId();
  const startOfToday = new Date(new Date().toLocaleDateString("en-CA", { timeZone: TIME_ZONE }) + "T00:00:00+10:00");
  const today = await prisma.run.findMany({
    where: { userId, sortAt: { gte: startOfToday } },
    orderBy: { sortAt: "asc" },
    select: { id: true, carId: true, setupSnapshotId: true, bestLapSeconds: true, eventId: true, meetingSessionType: true },
  });
  if (today.length === 0) throw new Error("No demo runs today — run `npm run demo:race-day` first.");
  const best = [...today].filter((r) => r.bestLapSeconds != null).sort((a, b) => a.bestLapSeconds! - b.bestLapSeconds!)[0] ?? today[0];
  const main = [...today].reverse().find((r) => r.meetingSessionType === "RACE") ?? today.at(-1)!;
  const thread = await prisma.engineerChatThread.findFirst({ where: { userId }, orderBy: { updatedAt: "desc" }, select: { id: true, messages: { orderBy: { createdAt: "asc" }, take: 1, select: { content: true } } } });
  return { best, main, eventId: today[0].eventId, carId: best.carId!, threadQuestion: thread?.messages[0]?.content ?? null };
}

async function shotList(): Promise<Shot[]> {
  const s = await subjects();
  return [
    { name: "dashboard", path: "/", full: true },
    // A run opens on its laps; "Setup" in the header opens the sheet over it.
    { name: "run-laps", path: `/runs/${s.best.id}`, full: true },
    {
      // The lap chart against a rival — the pitch page's share card is built on this view.
      name: "run-laps-chart",
      path: `/runs/${s.best.id}`,
      act: async (page) => {
        // Put the stats block at the top so the lap grid and the chart fill the phone. The header
        // has a "Laptimes" button too, so ask for the heading by role.
        await page.locator("span.eyebrow-label", { hasText: /^laptimes$/i }).first().evaluate((el) => el.scrollIntoView({ block: "start" }));
        await page.evaluate(() => window.scrollBy(0, -20));
        // Mid-scroll the condensed title floats over the content with no ground under it (a real
        // phone blurs it). For this one shot the top chrome goes; the content starts at the top.
        await page.addStyleTag({ content: ".mobile-brand-mark,.title-condenser,.fixed.right-4.z-40{display:none!important}" });
        await page.waitForTimeout(300);
        await page.locator('[role="tab"]', { hasText: /^field$/i }).first().click({ timeout: 5000, force: true }).catch(() => {});
        await page.waitForTimeout(600);
      },
    },
    {
      name: "run-setup",
      path: `/runs/${s.best.id}`,
      act: async (page) => { await page.getByRole("button", { name: "Setup", exact: true }).first().click(); },
      full: true,
    },
    { name: "run-main", path: `/runs/${s.main.id}` },
    {
      name: "engineer",
      path: "/engineer",
      act: async (page) => {
        if (!s.threadQuestion) return;
        await page.getByText(s.threadQuestion.slice(0, 30), { exact: false }).first().click();
        await page.waitForTimeout(800);
        // The transcript follows the newest words; the shot wants the question and the first answer.
        await page.getByText(s.threadQuestion.slice(0, 30), { exact: false }).first().scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollTo(0, 0));
      },
      full: true,
    },
    { name: "analysis", path: "/analysis", full: true },
    { name: "sessions", path: "/runs/history" },
    { name: "setup-sheet", path: `/cars/${s.carId}/setups/${s.best.setupSnapshotId}`, full: true },
    { name: "garage-car", path: `/cars/${s.carId}` },
    {
      name: "lab",
      path: "/analysis/roll-center",
      act: async (page) => {
        // Load the day's best setup into slot A through the Lab's own search.
        await page.getByPlaceholder(/Search setups/i).first().fill("State Titles");
        await page.waitForTimeout(800);
        await page.getByRole("option").or(page.getByRole("button", { name: /State Titles/ })).first().click();
      },
    },
    { name: "lap-analysis", path: "/laps/analysis" },
    ...(s.eventId ? [{ name: "event", path: `/events/${s.eventId}` }] : []),
  ];
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => (document as Document & { fonts: FontFaceSet }).fonts.ready);
  // A sheet page paints its picture after load; wait for the spinner to go, not just the network.
  await page.getByText("Drawing your sheet").waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

async function signIn(ctx: BrowserContext) {
  await ctx.addCookies([{ name: "rc_tz", value: TIME_ZONE, domain: new URL(BASE).hostname, path: "/" }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/api/auth/dev-signin?email=${encodeURIComponent(EMAIL)}&to=/`);
  await page.waitForLoadState("networkidle");
  if (page.url().includes("/login")) throw new Error(`dev-signin landed on /login — is ${BASE} a dev server?`);
  return page;
}

async function shoot(kind: "phone" | "desktop", shots: Array<Shot & { index: number }>) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(
    kind === "phone"
      // iPhone 15 Pro is 393×852; the stage script adds the 59pt status-bar band on top, so the app
      // gets the 793 below it — the composite comes out at exactly the device's 1179×2556.
      ? { viewport: { width: 393, height: 793 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, timezoneId: TIME_ZONE }
      : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, timezoneId: TIME_ZONE },
  );
  const page = await signIn(ctx);
  const dir = `${OUT}/${kind}`;
  mkdirSync(dir, { recursive: true });
  for (const shot of shots) {
    // Numbered by position in the FULL list, so a --pick re-shoot overwrites the right file.
    const stem = `${dir}/${String(shot.index).padStart(2, "0")}-${shot.name}`;
    try {
      await page.goto(`${BASE}${shot.path}`);
      await settle(page);
      await page.addStyleTag({ content: HIDE_CSS });
      if (shot.act) {
        await shot.act(page);
        await settle(page);
      }
      await page.mouse.move(0, 0);
      await page.screenshot({ path: `${stem}.png` });
      if (shot.full && kind === "phone") await page.screenshot({ path: `${stem}-full.png`, fullPage: true });
      console.log(`  ${stem}.png`);
    } catch (e) {
      console.error(`  ! ${shot.name}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  await browser.close();
}

async function main() {
  const all = (await shotList()).map((s, i) => ({ ...s, index: i + 1 }));
  const shots = PICK ? all.filter((s) => PICK.includes(s.name)) : all;
  console.log(`${shots.length} screens as ${EMAIL} on ${BASE}`);
  if (ONLY !== "desktop") { console.log("phone:"); await shoot("phone", shots); }
  if (ONLY !== "phone") { console.log("desktop:"); await shoot("desktop", shots); }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
