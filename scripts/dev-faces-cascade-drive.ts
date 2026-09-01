/**
 * Drive the setup-correction cascade on the FOLDED run view (RunFaces) — the surface that
 * replaced the run page on Analysis and the Sessions day. Proves the question sheet appears
 * at all, which is what the founder reported missing.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { normalizeSetupSnapshotForStorage } from "@/lib/runSetup";

const args = process.argv.slice(2);
const argValue = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const BASE = (argValue("base") ?? "http://localhost:3000").replace(/\/$/, "");
const EMAIL = "jordancaaruso@gmail.com";
const OUT =
  argValue("out") ??
  "C:/Users/Jordan/AppData/Local/Temp/claude/c--Users-Jordan-rc-engineer-app/cb6e5478-7e79-4f5d-819e-1ba41845ebf8/scratchpad/faces-shots";

const EDITS = [
  { key: "camber_front", next: "-2.17" },
  { key: "camber_rear", next: "-2.37" },
];

async function mintSignInUrl(): Promise<string> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET missing — run under dotenv-cli.");
  const token = randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: {
      identifier: EMAIL,
      token: createHash("sha256").update(`${token}${secret}`).digest("hex"),
      expires: new Date(Date.now() + 864e5),
    },
  });
  return `${BASE}/api/auth/callback/nodemailer?${new URLSearchParams({
    callbackUrl: `${BASE}/`,
    token,
    email: EMAIL,
  })}`;
}

type Snap = { runId: string; sortAt: Date; snapshotId: string | null; values: Record<string, string> };

async function readState(userId: string, carId: string): Promise<Snap[]> {
  const runs = await prisma.run.findMany({
    where: { userId, carId },
    orderBy: { sortAt: "desc" },
    take: 12,
    select: { id: true, sortAt: true, setupSnapshot: { select: { id: true, data: true } } },
  });
  return runs.map((r) => {
    const d = normalizeSetupSnapshotForStorage(r.setupSnapshot?.data ?? null);
    return {
      runId: r.id,
      sortAt: r.sortAt,
      snapshotId: r.setupSnapshot?.id ?? null,
      values: Object.fromEntries(EDITS.map((e) => [e.key, String(d[e.key] ?? "—")])),
    };
  });
}

function printState(title: string, rows: Snap[]) {
  console.log("\n" + title);
  rows.forEach((r, i) =>
    console.log(
      "  " +
        String(i).padStart(2) +
        " " +
        r.runId +
        " " +
        r.sortAt.toISOString().slice(0, 10) +
        "  " +
        EDITS.map((e) => e.key + "=" + r.values[e.key]).join("  ")
    )
  );
}

async function fillBox(page: Page, ariaLabel: string, value: string) {
  const box = page.locator('[data-sheet-box][aria-label="' + ariaLabel + '"]').first();
  await box.evaluate((el) => (el as HTMLElement).click());
  const input = page.locator("input[data-persistent-editor]").first();
  await input.waitFor({ state: "visible", timeout: 8000 });
  await input.fill(value);
  await input.press("Enter");
  await page.waitForTimeout(350);
}

function fixButton(page: Page) {
  return page
    .locator("[data-cascade-sheet] button")
    .filter({ hasText: /^(Fix |None chosen|Fixing)/ })
    .first();
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/:?]+)/)?.[1] ?? "?";
  console.log("DB:", host);
  if (host.includes("hidden-rice")) throw new Error("PRODUCTION — refusing.");
  mkdirSync(OUT, { recursive: true });

  const user = await prisma.user.findFirstOrThrow({ where: { email: EMAIL }, select: { id: true } });
  const newest = await prisma.run.findFirstOrThrow({
    where: { userId: user.id, carId: { not: null } },
    orderBy: { sortAt: "desc" },
    select: { id: true, carId: true },
  });
  const carId = newest.carId as string;
  const before = await readState(user.id, carId);
  printState("BEFORE", before);
  const targetRunId = newest.id;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
  ctx.setDefaultTimeout(20000);
  const page = await ctx.newPage();
  page.on("console", (m) => (m.type() === "error" ? console.log("  [console]", m.text().slice(0, 200)) : undefined));

  await page.goto(await mintSignInUrl(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  console.log("\nRUN " + targetRunId + " (car " + carId + ")");
  await page.goto(BASE + "/analysis", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: OUT + "/01-analysis.png", fullPage: true });

  const row = page.locator('[data-run-row="' + targetRunId + '"]');
  if ((await row.count()) === 0) {
    const ids = await page
      .locator("[data-run-row]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-run-row")));
    throw new Error("target row not on /analysis. rows=" + JSON.stringify(ids));
  }
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + "/02-open.png", fullPage: true });

  // The sheet is drawn INSIDE the Setup face now (2026-08-25) — arm the run's edit mode
  // and the paper becomes fillable in place. No pop-up in the path at all.
  await page.getByRole("tab", { name: /^Setup$/i }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /^Edit$/ }).first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + "/03-sheet.png", fullPage: true });
  await page.waitForSelector("[data-sheet-box]", { timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: OUT + "/04-editing.png", fullPage: true });

  const labels = await page
    .locator("[data-sheet-box]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  const camber = labels.filter((l) => /camber/i.test(l));
  console.log("  camber boxes:", JSON.stringify(camber));
  if (camber.length < 2) throw new Error("Could not find both camber boxes.");

  await fillBox(page, camber[0], EDITS[0].next);
  await fillBox(page, camber[1], EDITS[1].next);
  await page.screenshot({ path: OUT + "/05-typed.png" });

  await page.getByRole("button", { name: /Correct this run/i }).first().click();

  let sawSheet = true;
  try {
    await page.waitForSelector("[data-cascade-sheet]", { timeout: 15000 });
  } catch {
    sawSheet = false;
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + "/06-after-save.png", fullPage: true });
  console.log("\n  >>> CASCADE QUESTION SHEET APPEARED? " + (sawSheet ? "YES" : "NO — still broken"));

  if (sawSheet) {
    const counter = (await page.locator("[data-cascade-sheet] p").first().textContent())?.trim();
    const heading = (await page.locator("[data-cascade-sheet] h2").first().textContent())?.trim();
    const rows = page.locator("[data-cascade-sheet] button[aria-pressed]");
    console.log('  Q1 "' + counter + '" / ' + heading + "  candidates=" + (await rows.count()));
    for (const i of [0, 1]) {
      const r = rows.nth(i);
      if ((await r.count()) && (await r.getAttribute("aria-pressed")) === "false") await r.click();
    }
    await page.waitForTimeout(250);
    console.log('  Q1 button: "' + (await fixButton(page).textContent())?.trim() + '"');
    await page.screenshot({ path: OUT + "/07-q1-ticked.png" });
    await fixButton(page).click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: OUT + "/08-q2.png" });
    const q2label = (await fixButton(page).textContent())?.trim();
    console.log('  Q2 button: "' + q2label + '"  stuck=' + /Fixing/.test(q2label ?? ""));
    const rows2 = page.locator("[data-cascade-sheet] button[aria-pressed]");
    for (const i of [0, 1]) {
      const r = rows2.nth(i);
      if ((await r.count()) && (await r.getAttribute("aria-pressed")) === "false") await r.click();
    }
    await page.waitForTimeout(250);
    await fixButton(page)
      .click({ timeout: 8000 })
      .catch(() => console.log("  >>> Q2 button refused the click"));
    await page.waitForTimeout(3000);
    await page.screenshot({ path: OUT + "/09-done.png", fullPage: true });
    const body = await page.locator("body").innerText();
    console.log("  toast:", body.split("\n").find((l) => /fixed on|already said|couldn/i.test(l)) ?? "(none)");
  }

  await browser.close();

  const after = await readState(user.id, carId);
  printState("AFTER", after);

  const beforeById = new Map(before.map((b) => [b.runId, b]));
  let others = 0;
  for (const a of after) {
    const b = beforeById.get(a.runId);
    if (!b) continue;
    for (const e of EDITS) {
      if (a.values[e.key] !== b.values[e.key]) {
        const where = a.runId === targetRunId ? "the run I corrected" : "ANOTHER run";
        console.log("  " + e.key + ": " + b.values[e.key] + " → " + a.values[e.key] + "  (" + where + ")");
        if (a.runId !== targetRunId) others++;
      }
    }
  }
  console.log("\nVERDICT  sheet=" + sawSheet + "  other-run writes=" + others);

  if (process.env.RESTORE !== "0") {
    let restored = 0;
    for (const a of after) {
      const b = beforeById.get(a.runId);
      if (!b) continue;
      const changed = EDITS.filter((e) => a.values[e.key] !== b.values[e.key]);
      if (changed.length === 0 || !a.snapshotId) continue;
      const rowData = await prisma.setupSnapshot.findUniqueOrThrow({
        where: { id: a.snapshotId },
        select: { data: true },
      });
      const data = normalizeSetupSnapshotForStorage(rowData.data);
      for (const e of changed) {
        if (b.values[e.key] === "—") delete data[e.key];
        else data[e.key] = b.values[e.key];
      }
      await prisma.setupSnapshot.update({ where: { id: a.snapshotId }, data: { data: data as object } });
      restored++;
    }
    console.log("  restored " + restored + " snapshots");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
