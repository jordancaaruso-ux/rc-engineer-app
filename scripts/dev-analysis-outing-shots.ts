/**
 * dev-analysis-outing-shots.ts — DEV ONLY, throwaway. Drive the rebuilt
 * `/analysis` and the run that opens inside it, on REAL data.
 *
 * Proves what a typecheck cannot: the slim chart draws the same day the block
 * lists, a row actually unfolds into `RunFaces`, the faces swap, the pinned
 * strips stay put, and the teammates card breaks the fold on a 390px phone.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-analysis-outing-shots.ts --base=http://localhost:3005
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
const OUT = argValue("out") ?? "analysis-outing-shots";

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
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const loc = m.location();
    console.log(
      "  [console error]",
      m.text().slice(0, 400),
      `\n     at ${loc.url?.slice(-70) ?? "?"}:${loc.lineNumber ?? "?"}`
    );
  });
  page.on("requestfailed", (r) => console.log("  [request failed]", r.url().slice(0, 140)));

  await page.goto(await mintSignInUrl(EMAIL), { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});

  console.log("→ /analysis");
  await page.goto(`${BASE}/analysis`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/01-analysis-fold.png` });
  await page.screenshot({ path: `${OUT}/02-analysis-full.png`, fullPage: true });

  // Where does the teammates card start, relative to the fold? Pass a STRING to
  // evaluate — esbuild's `__name` helper does not exist inside the page.
  const measure = await page.evaluate(`(() => {
    const byText = (text) => [...document.querySelectorAll('span,div,h2')].find(
      (el) => el.textContent && el.textContent.trim().toLowerCase() === text
    );
    const top = (el) => (el ? Math.round(el.getBoundingClientRect().top) : null);
    // The bottom dock, found by a cell that only it has — its top edge IS the fold.
    const dockCell = [...document.querySelectorAll('a,button')].find(
      (el) => el.textContent && el.textContent.trim() === 'Paddock'
    );
    let dock = dockCell;
    while (dock && getComputedStyle(dock).position !== 'fixed') dock = dock.parentElement;
    const chartCard = document.querySelector('main svg')?.closest('[class*="rounded"]');
    return JSON.stringify({
      viewport: window.innerHeight,
      dockTop: dock ? Math.round(dock.getBoundingClientRect().top) : null,
      chartCardBottom: chartCard ? Math.round(chartCard.getBoundingClientRect().bottom) : null,
      outingTop: top(byText('last time out')),
      firstRowTop: top(document.querySelector('[data-run-row]')),
      doorTop: top(byText('all your sessions')),
      teammatesTop: top(byText('teammates')),
    });
  })()`);
  console.log("  fold measurement:", measure);

  const rowCount = await page.locator("[data-run-row]").count();
  console.log(`  run rows on the page: ${rowCount}`);

  // Heights of the three things competing for the fold.
  const heights = await page.evaluate(`(() => {
    const card = (text) => {
      const el = [...document.querySelectorAll('span')].find(
        (n) => n.textContent && n.textContent.trim().toLowerCase() === text
      );
      let node = el;
      while (node && !(node.className && String(node.className).includes('rounded'))) node = node.parentElement;
      return node ? Math.round(node.getBoundingClientRect().height) : null;
    };
    const chart = document.querySelector('svg');
    return JSON.stringify({
      chartSvg: chart ? Math.round(chart.getBoundingClientRect().height) : null,
      outingCard: card('last time out'),
      rowHeight: (() => {
        const r = document.querySelector('[data-run-row]');
        return r ? Math.round(r.getBoundingClientRect().height) : null;
      })(),
    });
  })()`);
  console.log("  heights:", heights);

  // Open the newest run.
  const firstRow = page.locator("[data-run-row]").first();
  if ((await firstRow.count()) > 0) {
    await firstRow.click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/03-run-open-laps.png`, fullPage: true });

    for (const face of ["Setup", "Notes"]) {
      const tab = page.getByRole("tab", { name: face });
      if ((await tab.count()) > 0) {
        await tab.first().click();
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${OUT}/04-run-${face.toLowerCase()}.png`, fullPage: true });
      } else {
        console.log(`  !! no ${face} tab found`);
      }
    }

    // Edit mode — the inline controls and the delete door.
    const edit = page.getByRole("button", { name: "Edit" });
    if ((await edit.count()) > 0) {
      await edit.first().click();
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${OUT}/05-run-editing.png`, fullPage: true });
      // The Setup face in edit mode — the inline pickers that correct the rubber.
      const setupTab = page.getByRole("tab", { name: "Setup" });
      if ((await setupTab.count()) > 0) {
        await setupTab.first().click();
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${OUT}/05b-setup-editing.png`, fullPage: true });
      }
      await edit.first().click().catch(() => {});
    }
  } else {
    console.log("  !! no run rows to open");
  }

  // The rest of the day.
  const more = page.getByRole("button", { name: /more run|[0-9]+ more/i });
  if ((await more.count()) > 0) {
    await more.first().click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/06-day-unfolded.png`, fullPage: true });
  } else {
    console.log("  (no chevron — this outing has three runs or fewer)");
  }

  console.log("→ /runs/history (the day view uses the same run component)");
  await page.goto(`${BASE}/runs/history`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
  const session = page.locator("button", { hasText: /run/i }).first();
  await session.click().catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/07-sessions-day.png`, fullPage: true });
  const sessionRow = page.locator('button[aria-expanded="false"]').filter({ hasText: /laps/ }).first();
  if ((await sessionRow.count()) > 0) {
    await sessionRow.click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/08-sessions-run-open.png`, fullPage: true });
  }

  /*
   * The race field. A test day has none, so the notebook of driver tabs only shows
   * on a day with a multi-driver import — 15 July here, five and six-car races.
   */
  console.log("→ the race day (driver tabs)");
  await page.goto(`${BASE}/runs/history`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1000);
  const raceDay = page.locator("button", { hasText: /15 Jul/ }).first();
  if ((await raceDay.count()) > 0) {
    await raceDay.click();
    await page.waitForTimeout(1200);
    const raceRun = page
      .locator('button[aria-expanded="false"]')
      .filter({ hasText: /laps/ })
      .first();
    if ((await raceRun.count()) > 0) {
      await raceRun.click();
      await page.waitForTimeout(1800);
      await page.screenshot({ path: `${OUT}/09-race-field.png`, fullPage: true });
      // The dock is fixed, so a full-page capture paints it over the middle of the
      // run. Scroll the lap area up and take a plain viewport shot as well.
      await page.evaluate(`window.scrollBy(0, 520)`);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/09b-race-field-tabs.png` });
      const tabStrip = await page.evaluate(`(() => {
        const el = [...document.querySelectorAll('div')].find(
          (n) => n.className && String(n.className).includes('overflow-x-auto') && n.textContent.length < 200
        );
        return el ? el.textContent.trim().slice(0, 160) : null;
      })()`);
      console.log("  tab strip reads:", tabStrip);
    } else {
      console.log("  !! no run row on the race day");
    }
  } else {
    console.log("  !! no 15 Jul session in the rail");
  }

  await browser.close();
  await prisma.$disconnect();
  console.log(`\nShots in ${OUT}/`);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
