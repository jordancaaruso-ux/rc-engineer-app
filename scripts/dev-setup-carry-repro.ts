/**
 * dev-setup-carry-repro.ts — DEV ONLY, throwaway.
 *
 * The user report: "I edit my setup while logging a run, then when I log the NEXT run
 * it comes up with the OLD setup — the change doesn't persist."
 *
 * Drives it on real data: prefill from the last run, change Toe · Rear on the sheet,
 * save the run, then start another run and read the same box back.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";

const BASE = process.env.REPRO_BASE ?? "http://localhost:3000";
const EMAIL = "jordancaaruso@gmail.com";
const OUT = process.env.REPRO_OUT!;
const BOX = "Toe · Rear";
const KEY = "toe_rear";

async function mintSignInUrl() {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET missing");
  const token = randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: {
      identifier: EMAIL,
      token: createHash("sha256").update(token + secret).digest("hex"),
      expires: new Date(Date.now() + 864e5),
    },
  });
  const q = new URLSearchParams({ callbackUrl: BASE + "/", token, email: EMAIL });
  return BASE + "/api/auth/callback/nodemailer?" + q.toString();
}

async function shot(page: Page, n: string) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + "/" + n + ".png", fullPage: true });
}

async function openSetupStep(page: Page) {
  await page.goto(BASE + "/runs/new", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByRole("button", { name: /prefill this run/i }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /^Setup\b/ }).first().click();
  await page.waitForTimeout(2600);
}

const box = (page: Page) => page.locator("[data-sheet-box]").filter({ hasText: /./ }).and(
  page.locator('[aria-label="' + BOX + '"]')
);

async function readBox(page: Page) {
  const b = page.locator('[data-sheet-box][aria-label="' + BOX + '"]').first();
  return (await b.innerText()).replace(/\s+/g, " ").trim();
}

/** Newest run on the A800RR, as the database has it. */
async function newestRun(userId: string) {
  return prisma.run.findFirst({
    where: { userId },
    orderBy: { sortAt: "desc" },
    select: {
      id: true, sortAt: true, sessionLabel: true, loggingCompletedAt: true,
      setupSnapshot: { select: { id: true, baseSetupSnapshotId: true, data: true } },
    },
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const user = await prisma.user.findFirstOrThrow({ where: { email: EMAIL }, select: { id: true } });
  const before = await newestRun(user.id);
  console.log("BEFORE — newest run " + before?.id.slice(0, 8) + " " + before?.sortAt.toISOString().slice(0, 16) +
    "  " + KEY + "=" + JSON.stringify((before?.setupSnapshot?.data as any)?.[KEY]));

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("  [console] " + m.text().slice(0, 200));
  });
  page.on('request', (r) => {
    if (r.method() !== "POST" || !r.url().includes("/api/runs")) return;
    let b: any = {};
    try { b = JSON.parse(r.postData() || '{}'); } catch {}
    const sd = b.setupData || {};
    console.log('  [POST /api/runs] baselineSetupSnapshotId=' + b.baselineSetupSnapshotId +
      ' setupDeltaOnly=' + b.setupDeltaOnly +
      ' setupDelta.' + KEY + '=' + JSON.stringify((b.setupDelta||{})[KEY]) +
      ' setupData.' + KEY + '=' + JSON.stringify(sd[KEY]) +
      ' setupData keys=' + Object.keys(sd).length +
      ' setupDelta keys=' + Object.keys(b.setupDelta||{}).length);
  });
  await page.goto(await mintSignInUrl(), { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});

  // ---------------- RUN A: edit the setup while logging ----------------
  console.log("\n=== RUN A — log a run and change the rear toe on the sheet");
  await openSetupStep(page);
  const was = await readBox(page);
  console.log("  sheet shows " + BOX + " = " + JSON.stringify(was));

  // NOT a sign flip: `toe_rear` is forced positive by geometrySignNormalize, so
  // typing -3 comes back as 3 and would read as a lost edit when it isn't one.
  const target = was === "2.4" ? "2.6" : "2.4";
  await page.locator('[data-sheet-box][aria-label="' + BOX + '"]').first().click();
  await page.waitForTimeout(500);
  const editor = page.locator("[data-persistent-editor]").first();
  await editor.fill(target);
  await editor.press("Enter");
  await page.waitForTimeout(800);
  console.log("  typed " + target + "; sheet now shows " + JSON.stringify(await readBox(page)));
  await shot(page, "10-runA-edited");

  await page.getByRole("button", { name: /save to this run/i }).click();
  await page.waitForTimeout(3000);
  await shot(page, "11-runA-saved");

  const runA = await newestRun(user.id);
  const aVal = (runA?.setupSnapshot?.data as any)?.[KEY];
  console.log("  RUN A stored: run=" + runA?.id.slice(0, 8) + " snap=" + runA?.setupSnapshot?.id.slice(0, 8) +
    " " + KEY + "=" + JSON.stringify(aVal) + (runA?.id === before?.id ? "   <-- NO NEW RUN WAS CREATED" : ""));

  // ---------------- RUN B: start the next run ----------------
  console.log("\n=== RUN B — start the next run and see what the setup comes up as");
  await openSetupStep(page);
  const nowShows = await readBox(page);
  console.log("  sheet shows " + BOX + " = " + JSON.stringify(nowShows));
  await shot(page, "20-runB-setup");

  console.log("\n---------------- VERDICT ----------------");
  console.log("  before the edit : " + was);
  console.log("  typed on run A  : " + target);
  console.log("  run A stored    : " + JSON.stringify(aVal));
  console.log("  run B opens on  : " + nowShows);
  console.log(nowShows === target
    ? "  => the change CARRIED FORWARD."
    : "  => REPRODUCED: the next run came up with the old value.");

  await browser.close();
}
main().finally(() => prisma.$disconnect());
