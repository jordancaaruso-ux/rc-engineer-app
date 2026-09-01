/**
 * drive-cascade.ts — DEV ONLY. Drive the run setup correction cascade on REAL data.
 *
 * Proves the two things a typecheck cannot:
 *   A. a save that moves TWO boxes asks two questions, and the SECOND one's button works
 *      (it used to open stuck on "Fixing…");
 *   B. ticking an EARLIER run actually writes it (the server used to drop it silently).
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     <this> --base=http://localhost:3005
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { normalizeSetupSnapshotForStorage } from "@/lib/runSetup";

const args = process.argv.slice(2);
const argValue = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const BASE = (argValue("base") ?? "http://localhost:3005").replace(/\/$/, "");
const EMAIL = "jordancaaruso@gmail.com";
const CAR_ID = "cmpw8xx4a0005le04l8uwg99u"; // A800RR, 44 runs
const OUT = argValue("out") ?? "C:/Users/Jordan/AppData/Local/Temp/claude/c--Users-Jordan-rc-engineer-app/7b54f1b7-b2cf-4c50-b2ad-cd3d379a0121/scratchpad/cascade-shots";

/** Two values nothing on the car already holds — see the "three distinct values" trap. */
const EDITS = [
  { key: "camber_front", label: /^Camber/i, next: "-2.15" },
  { key: "camber_rear", label: /^Camber/i, next: "-2.35" },
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

async function readState(userId: string): Promise<Snap[]> {
  const runs = await prisma.run.findMany({
    where: { userId, carId: CAR_ID },
    orderBy: { sortAt: "desc" },
    take: 10,
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
  console.log(`\n${title}`);
  rows.forEach((r, i) =>
    console.log(
      `  ${String(i).padStart(2)} ${r.runId} ${r.sortAt.toISOString().slice(0, 10)}  ` +
        EDITS.map((e) => `${e.key}=${r.values[e.key]}`).join("  ")
    )
  );
}

/** Put a value in one sheet box. The persistent editor covers the box it edited, hence evaluate(). */
async function fillBox(page: Page, ariaLabel: string, value: string) {
  const box = page.locator(`[data-sheet-box][aria-label="${ariaLabel}"]`).first();
  await box.evaluate((el) => (el as HTMLElement).click());
  const input = page.locator("input[data-persistent-editor]").first();
  await input.waitFor({ state: "visible", timeout: 8000 });
  await input.fill(value);
  await input.press("Enter");
  await page.waitForTimeout(350);
}

/** The cascade sheet's Fix button, scoped — the setup modal is also role=dialog. */
function fixButton(page: Page) {
  return page.locator("[data-cascade-sheet] button").filter({ hasText: /^(Fix |None chosen|Fixing)/ }).first();
}

async function describeSheet(page: Page, tag: string) {
  const sheet = page.locator("[data-cascade-sheet]");
  const heading = (await sheet.locator("h2").first().textContent())?.trim();
  const counter = (await sheet.locator("p").first().textContent())?.trim();
  const btn = fixButton(page);
  const label = (await btn.textContent())?.trim();
  const disabled = await btn.isDisabled();
  console.log(`  [${tag}] "${counter}" / ${heading}`);
  console.log(`  [${tag}] button = "${label}"  disabled=${disabled}`);
  return { label, disabled };
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/:?]+)/)?.[1] ?? "?";
  console.log("DB:", host);
  if (host.includes("hidden-rice")) throw new Error("PRODUCTION — refusing.");
  mkdirSync(OUT, { recursive: true });

  const user = await prisma.user.findFirstOrThrow({ where: { email: EMAIL }, select: { id: true } });
  const before = await readState(user.id);
  printState("BEFORE", before);
  const target = before[0]; // the NEWEST run — the case the backward walk exists for

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
  ctx.setDefaultTimeout(20000); // raw chromium.launch has NO action timeout — a dead button hangs forever
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && console.log("  [console]", m.text().slice(0, 160)));

  await page.goto(await mintSignInUrl(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  console.log(`\nRUN ${target.runId}`);
  await page.goto(`${BASE}/runs/${target.runId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/01-run.png`, fullPage: true });

  await page.locator('[aria-label="Edit this run"]').first().click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /Edit setup on the sheet/i }).click();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}/02-sheet.png` });

  // What are the boxes actually called? (aria-label carries the name; data-sheet-box is a marker.)
  const labels = await page.locator("[data-sheet-box]").evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label") ?? "")
  );
  const camber = labels.filter((l) => /camber/i.test(l));
  console.log("  camber boxes:", JSON.stringify(camber));
  if (camber.length < 2) throw new Error("Could not find both camber boxes on the sheet.");

  await fillBox(page, camber[0], EDITS[0].next);
  await fillBox(page, camber[1], EDITS[1].next);
  await page.screenshot({ path: `${OUT}/03-two-boxes-typed.png` });

  await page.getByRole("button", { name: /Correct this run/i }).first().click();
  await page.waitForSelector("[data-cascade-sheet]", { timeout: 20000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/04-question-1.png` });

  // ============ QUESTION 1 ============
  const q1 = await describeSheet(page, "Q1");
  const rows1 = page.locator("[data-cascade-sheet] button[aria-pressed]");
  console.log("  Q1 candidate rows:", await rows1.count());
  // Earlier runs arrive unticked by design — tick the two nearest.
  for (const i of [0, 1]) {
    const r = rows1.nth(i);
    if ((await r.getAttribute("aria-pressed")) === "false") await r.click();
  }
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/05-question-1-ticked.png` });
  const ticked1 = (await fixButton(page).textContent())?.trim();
  console.log(`  Q1 after ticking: "${ticked1}"`);
  await fixButton(page).click();
  await page.waitForTimeout(2500);

  // ============ QUESTION 2 — the stuck-button case ============
  await page.screenshot({ path: `${OUT}/06-question-2.png` });
  const q2 = await describeSheet(page, "Q2");
  const STUCK = /Fixing/.test(q2.label ?? "");
  console.log(`\n  >>> Q2 STUCK ON "Fixing…"? ${STUCK ? "YES — BUG PRESENT" : "no"}`);

  const rows2 = page.locator("[data-cascade-sheet] button[aria-pressed]");
  console.log("  Q2 candidate rows:", await rows2.count());
  for (const i of [0, 1]) {
    const r = rows2.nth(i);
    if ((await r.getAttribute("aria-pressed")) === "false") await r.click();
  }
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/07-question-2-ticked.png` });
  console.log(`  Q2 after ticking: "${(await fixButton(page).textContent())?.trim()}"`);
  try {
    await fixButton(page).click({ timeout: 8000 });
  } catch {
    console.log("  >>> Q2 Fix button REFUSED THE CLICK (disabled) — the sheet is dead.");
  }
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/08-after.png`, fullPage: true });

  const toast = await page.locator("body").innerText();
  const toastLine = toast.split("\n").find((l) => /fixed on|already said|couldn/i.test(l));
  console.log("  toast:", toastLine ?? "(none found)");

  await browser.close();

  const after = await readState(user.id);
  printState("AFTER", after);

  console.log("\nVERDICT");
  const beforeById = new Map(before.map((b) => [b.runId, b]));
  let earlierWritten = 0;
  for (const a of after) {
    const b = beforeById.get(a.runId)!;
    for (const e of EDITS) {
      if (a.values[e.key] !== b.values[e.key]) {
        const where = a.runId === target.runId ? "the run I corrected" : "an EARLIER run";
        console.log(`  ${e.key}: ${b.values[e.key]} → ${a.values[e.key]}  (${where})`);
        if (a.runId !== target.runId) earlierWritten++;
      }
    }
  }
  console.log(`  earlier-run writes that landed: ${earlierWritten}`);
  console.log(`  Q2 button stuck: ${STUCK}`);

  // ---- put Jordan's data back ----
  if (process.env.RESTORE !== "0") {
    let restored = 0;
    for (const a of after) {
      const b = beforeById.get(a.runId)!;
      const changed = EDITS.filter((e) => a.values[e.key] !== b.values[e.key]);
      if (changed.length === 0 || !a.snapshotId) continue;
      const row = await prisma.setupSnapshot.findUniqueOrThrow({
        where: { id: a.snapshotId },
        select: { data: true },
      });
      const data = normalizeSetupSnapshotForStorage(row.data);
      for (const e of changed) {
        if (b.values[e.key] === "—") delete data[e.key];
        else data[e.key] = b.values[e.key];
      }
      await prisma.setupSnapshot.update({ where: { id: a.snapshotId }, data: { data: data as object } });
      restored++;
    }
    console.log(`  restored ${restored} snapshots to their original values`);
    printState("RESTORED", await readState(user.id));
  }
}

main()
  .catch((e) => {
    console.error("FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
