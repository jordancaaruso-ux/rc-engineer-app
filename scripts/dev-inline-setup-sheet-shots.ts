/**
 * dev-inline-setup-sheet-shots.ts — DEV ONLY, throwaway. Drive the sheet now drawn
 * INSIDE a run's Setup face, on REAL data.
 *
 * Proves what a typecheck cannot: the wrench on a row opens that run on Setup, the
 * whole page picture draws in place, Edit arms the boxes and renames itself Cancel,
 * and every exit with typing behind it asks first.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-inline-setup-sheet-shots.ts --base=http://localhost:3000
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
const OUT = argValue("out") ?? "inline-setup-shots";

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
    console.log("  [console error]", m.text().slice(0, 300));
  });

  await page.goto(await mintSignInUrl(EMAIL), { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});

  /** The sheet, once its page picture has actually landed. */
  const sheetImage = page.locator("main img[alt], main img").filter({ hasNot: page.locator("x") });

  console.log("→ /analysis — the wrench that never existed here");
  await page.goto(`${BASE}/analysis`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/01-analysis-rows.png` });

  const wrench = page.getByRole("button", { name: /view setup sheet for/i }).first();
  console.log(`  wrenches on the analysis rows: ${await page
    .getByRole("button", { name: /view setup sheet for/i })
    .count()}`);
  if ((await wrench.count()) === 0) throw new Error("no wrench on /analysis rows");

  await wrench.click();
  await page.waitForTimeout(2500);
  const openFace = await page
    .getByRole("tab", { selected: true })
    .first()
    .textContent()
    .catch(() => null);
  console.log(`  face the wrench opened: ${openFace}`);
  await page.screenshot({ path: `${OUT}/02-analysis-setup-face.png`, fullPage: true });

  // How much of the row the sheet actually occupies, and whether the page drew whole.
  const sheetBox = await page.evaluate(`(() => {
    const img = [...document.querySelectorAll('main img')].find(
      (n) => n.naturalWidth > 400 && n.getBoundingClientRect().width > 200
    );
    if (!img) return JSON.stringify({ found: false });
    const r = img.getBoundingClientRect();
    return JSON.stringify({
      found: true,
      drawnWidth: Math.round(r.width),
      drawnHeight: Math.round(r.height),
      naturalRatio: +(img.naturalHeight / img.naturalWidth).toFixed(3),
      drawnRatio: +(r.height / r.width).toFixed(3),
    });
  })()`);
  console.log("  sheet picture:", sheetBox);

  console.log("→ arming the sheet");
  const edit = page.getByRole("button", { name: /^Edit$/ }).first();
  if ((await edit.count()) === 0) throw new Error("no Edit action on the open run");
  await edit.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/03-sheet-armed.png`, fullPage: true });
  const cancelSeen = await page.getByRole("button", { name: /^Cancel$/ }).count();
  const doneSeen = await page.getByRole("button", { name: /^Done$/ }).count();
  console.log(`  toggle reads Cancel: ${cancelSeen > 0} · still says Done: ${doneSeen > 0}`);

  console.log("→ typing into a box, then trying to leave three ways");
  // The fill surface exposes each box as a [data-sheet-box] hit target.
  const box = page.locator("[data-sheet-box]").first();
  if ((await box.count()) === 0) {
    console.log("  !! no fillable boxes — this car may not draw as a sheet");
  } else {
    await box.click();
    await page.waitForTimeout(600);
    await page.keyboard.type("3.5");
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/04-typed.png`, fullPage: true });

    // 1. another face
    await page.getByRole("tab", { name: "Laps" }).first().click();
    await page.waitForTimeout(700);
    const askedOnFace = await page.getByText(/unsaved change/i).count();
    console.log(`  switching face asked: ${askedOnFace > 0}`);
    await page.screenshot({ path: `${OUT}/05-exit-prompt.png` });
    if (askedOnFace > 0) await page.getByRole("button", { name: /keep editing/i }).click();
    await page.waitForTimeout(500);

    // 2. folding the row — the exit that belongs to the LIST
    await page.locator("[data-run-row]").first().click();
    await page.waitForTimeout(700);
    const askedOnFold = await page.getByText(/unsaved change/i).count();
    console.log(`  folding the row asked: ${askedOnFold > 0}`);
    await page.screenshot({ path: `${OUT}/06-fold-prompt.png` });
    if (askedOnFold > 0) await page.getByRole("button", { name: /keep editing/i }).click();
    await page.waitForTimeout(500);

    // 3. Cancel
    await page.getByRole("button", { name: /^Cancel$/ }).first().click();
    await page.waitForTimeout(700);
    const askedOnCancel = await page.getByText(/unsaved change/i).count();
    console.log(`  Cancel asked: ${askedOnCancel > 0}`);
    await page.screenshot({ path: `${OUT}/07-cancel-prompt.png` });
    if (askedOnCancel > 0) {
      await page.getByRole("button", { name: /discard changes/i }).click();
      await page.waitForTimeout(900);
    }
    await page.screenshot({ path: `${OUT}/08-after-discard.png`, fullPage: true });
  }

  console.log("→ /runs/history — the same face, from the Sessions day");
  await page.goto(`${BASE}/runs/history`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1400);
  const day = page.locator("button", { hasText: /run/i }).first();
  await day.click().catch(() => {});
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${OUT}/09-sessions-day.png`, fullPage: true });
  const sessionWrench = page.getByRole("button", { name: /view setup sheet for/i }).first();
  if ((await sessionWrench.count()) > 0) {
    await sessionWrench.click();
    await page.waitForTimeout(2500);
    const face = await page
      .getByRole("tab", { selected: true })
      .first()
      .textContent()
      .catch(() => null);
    console.log(`  sessions wrench opened face: ${face}`);
    await page.screenshot({ path: `${OUT}/10-sessions-setup-face.png`, fullPage: true });
  } else {
    console.log("  !! no wrench on the sessions rows");
  }

  await browser.close();
  await prisma.$disconnect();
  console.log(`\nwrote ${OUT}/`);
}

void main();
