/**
 * dev-derived-box-repro.ts — DEV ONLY. Does a derived box on the setup sheet move when the box
 * it is worked out from moves?
 *
 * Spring rate is a lookup on (spring, SRS arrangement, spring gap − lower arm extension); final
 * drive is 1.9 × spur ÷ pinion. Both are printed on the A800RR sheet, and both are boxes the
 * driver can see change nothing while they edit the inputs beside them.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-derived-box-repro.ts --base=http://localhost:3000
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
const OUT = argValue("out") ?? "derived-box-shots";

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

/** What a box currently DRAWS, read off the paper rather than out of React. */
async function boxText(page: Page, label: string): Promise<string> {
  const b = page.locator(`[data-sheet-box][aria-label="${label}"]`).first();
  if ((await b.count()) === 0) return "<no such box>";
  return ((await b.textContent()) ?? "").trim();
}

async function typeIntoBox(page: Page, label: string, text: string): Promise<void> {
  await page.locator(`[data-sheet-box][aria-label="${label}"]`).first().click();
  await page.waitForTimeout(400);
  const editor = page.locator("[data-persistent-editor]").first();
  await editor.fill("");
  await editor.type(text, { delay: 40 });
  await page.waitForTimeout(500);
  // Step off it before reading: the box being typed into draws its value in the input sitting over
  // it, not on the paper, so reading it while focused reports a blank.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
}

/** A one-of-many row prints each choice as its own box, labelled `Field — Option`. */
async function chosenOption(page: Page, field: string): Promise<string> {
  const on = page.locator(`[data-sheet-box][aria-label^="${field} — "][aria-pressed="true"]`);
  if ((await on.count()) === 0) return "(none ticked)";
  const label = (await on.first().getAttribute("aria-label")) ?? "";
  return label.split(" — ").slice(1).join(" — ");
}

async function report(page: Page, when: string) {
  const rows = [
    ["spring gap · front", await boxText(page, "Spring gap · Front")],
    ["spring · front", await chosenOption(page, "Spring · Front")],
    ["SRS · front", await chosenOption(page, "SRS arrangement · Front")],
    ["→ SPRING RATE · front", await boxText(page, "Spring rate · Front — worked out from the sheet")],
    ["spur", await boxText(page, "Spur")],
    ["pinion", await boxText(page, "Pinion")],
    ["→ FINAL DRIVE RATIO", await boxText(page, "Final drive ratio — worked out from the sheet")],
  ];
  console.log(`\n  ${when}`);
  for (const [k, v] of rows) console.log(`    ${k.padEnd(26)} ${v || "(blank)"}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("  [console error]", m.text().slice(0, 200));
  });
  // Named, not just counted: "a 404 somewhere on this page" is not something to wave through.
  page.on("response", (r) => {
    if (r.status() >= 400) console.log(`  [${r.status()}]`, r.url().replace(BASE, ""));
  });

  await page.goto(await mintSignInUrl(EMAIL), { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});

  console.log("→ /analysis, open a run on Setup, arm the sheet");
  await page.goto(`${BASE}/analysis`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  const wrench = page.getByRole("button", { name: /view setup sheet for/i }).first();
  if ((await wrench.count()) === 0) throw new Error("no wrench on /analysis rows");
  await wrench.click();
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: /^Edit$/ }).first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/01-armed.png`, fullPage: true });

  await report(page, "as opened");

  console.log("\n→ changing the SPRING GAP (front) to 2.0");
  await typeIntoBox(page, "Spring gap · Front", "2.0");
  await report(page, "after the gap moved");
  await page.screenshot({ path: `${OUT}/02-gap-changed.png`, fullPage: true });
  await closeUp(page, "05-close-up-with-a-value");

  console.log("\n→ changing the PINION to 40");
  await typeIntoBox(page, "Pinion", "40");
  await report(page, "after the pinion moved");
  await page.screenshot({ path: `${OUT}/03-pinion-changed.png`, fullPage: true });

  console.log("\n→ erasing the SPRING GAP — a rate worked out from nothing is not a reading");
  await typeIntoBox(page, "Spring gap · Front", "");
  await report(page, "after the gap was erased");
  await closeUp(page, "06-close-up-cleared");

  console.log("\n→ a derived box must refuse the tap");
  const rate = page
    .locator('[data-sheet-box][aria-label="Spring rate · Front — worked out from the sheet"]')
    .first();
  console.log(`  aria-disabled on the rate box: ${await rate.getAttribute("aria-disabled")}`);
  // `force`, because Playwright refuses an aria-disabled element outright — which is the point,
  // but it would end the run rather than let us check what the tap actually did.
  await rate.click({ force: true });
  await page.waitForTimeout(600);
  const editorOpen = await page.locator("[data-persistent-editor]").count();
  console.log(`  tapping it opened an editor: ${editorOpen > 0}`);
  await page.screenshot({ path: `${OUT}/04-derived-box-refuses.png`, fullPage: true });

  /*
   * The OTHER door, and the busiest one. The wizard's sheet is the same surface, but its parent
   * runs its own derivation over the whole snapshot (`applyDerivedFieldsToSnapshot`) — so this is
   * here to prove the two agree rather than fight.
   */
  console.log("\n→ /runs/new — the log-run wizard's own sheet");
  await page.goto(`${BASE}/runs/new`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2500);
  // The wizard is stepped, and the setup section is not the step it opens on.
  for (let i = 0; i < 4; i++) {
    if ((await page.locator("[data-sheet-box]").count()) > 0) break;
    const next = page.getByRole("button", { name: /^(Next|Continue)$/i }).first();
    if ((await next.count()) === 0) break;
    await next.click();
    await page.waitForTimeout(1800);
  }
  await page.screenshot({ path: `${OUT}/07-wizard-where-we-got-to.png`, fullPage: true });
  const gapOnWizard = page.locator('[data-sheet-box][aria-label="Spring gap · Front"]').first();
  if ((await gapOnWizard.count()) === 0) {
    console.log(
      `  !! no spring-gap box here — boxes on screen: ${await page.locator("[data-sheet-box]").count()}`
    );
  } else {
    await report(page, "as the wizard opened it");
    // A blank sheet: the rate needs the spring and the SRS arrangement as well as the gap, and
    // both of those are printed CHOICE boxes — ticked, not typed. That path has its own updater.
    await typeIntoBox(page, "Spring gap · Front", "1.4");
    await report(page, "gap alone — not enough to work a rate out from");
    await page.locator('[data-sheet-box][aria-label="Spring · Front — STD"]').first().click();
    await page.waitForTimeout(700);
    await page.locator('[data-sheet-box][aria-label="SRS arrangement · Front — I"]').first().click();
    await page.waitForTimeout(900);
    await report(page, "after ticking the spring and the SRS");
    await typeIntoBox(page, "Spur", "100");
    await typeIntoBox(page, "Pinion", "38");
    await report(page, "after spur and pinion");
    await page.screenshot({ path: `${OUT}/08-wizard-filled.png`, fullPage: true });
  }

  console.log("\n(leaving without saving)");
  await browser.close();
  await prisma.$disconnect();
  console.log(`\nwrote ${OUT}/`);
}

/*
 * A close-up of the derived box beside the box it follows — the only way to judge whether a box
 * that draws no fill tint reads as "worked out for you" or as "broken".
 */
async function closeUp(page: Page, name: string) {
  // Off the sheet first, or the hover name sits over the very boxes being looked at.
  await page.mouse.move(4, 4);
  await page.waitForTimeout(300);
  const clip = await page.evaluate(`(() => {
    const pick = (label) => document.querySelector('[data-sheet-box][aria-label="' + label + '"]');
    const a = pick('Spring gap \\u00b7 Front');
    const b = pick('Spring rate \\u00b7 Front \\u2014 worked out from the sheet');
    if (!a || !b) return null;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const x = Math.min(ra.left, rb.left) - 120, y = Math.min(ra.top, rb.top) - 40;
    const r = Math.max(ra.right, rb.right) + 30, bo = Math.max(ra.bottom, rb.bottom) + 40;
    return JSON.stringify({ x: Math.max(0, x), y: Math.max(0, y), width: r - x, height: bo - y });
  })()`);
  if (clip) {
    await page.screenshot({ path: `${OUT}/${name}.png`, clip: JSON.parse(clip as string) });
    console.log(`  wrote ${name}.png`);
  } else {
    console.log("  !! could not find both boxes on this page");
  }
}

void main();
