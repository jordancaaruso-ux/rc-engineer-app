/**
 * Drive the setup-correction cascade from the SESSIONS GUTTER wrench — the phone's only
 * door into a run's sheet from a day. That door refreshed the page and dropped the
 * "did your other runs have this wrong too?" questions until 2026-08-25.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-gutter-cascade-drive.ts --base=http://localhost:3000
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
  "C:/Users/Jordan/AppData/Local/Temp/claude/c--Users-Jordan-rc-engineer-app/cb6e5478-7e79-4f5d-819e-1ba41845ebf8/scratchpad/gutter-shots";

const EDITS = [
  { key: "camber_front", next: "-2.19" },
  { key: "camber_rear", next: "-2.39" },
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

type Snap = { runId: string; snapshotId: string | null; values: Record<string, string> };

async function readState(userId: string): Promise<Snap[]> {
  const runs = await prisma.run.findMany({
    where: { userId },
    orderBy: { sortAt: "desc" },
    take: 60,
    select: { id: true, setupSnapshot: { select: { id: true, data: true } } },
  });
  return runs.map((r) => {
    const d = normalizeSetupSnapshotForStorage(r.setupSnapshot?.data ?? null);
    return {
      runId: r.id,
      snapshotId: r.setupSnapshot?.id ?? null,
      values: Object.fromEntries(EDITS.map((e) => [e.key, String(d[e.key] ?? "—")])),
    };
  });
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
  const before = await readState(user.id);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
  ctx.setDefaultTimeout(20000);
  const page = await ctx.newPage();
  page.on("console", (m) => (m.type() === "error" ? console.log("  [console]", m.text().slice(0, 200)) : undefined));

  await page.goto(await mintSignInUrl(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  await page.goto(BASE + "/runs/history", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: OUT + "/01-sessions.png", fullPage: true });

  // Land on the most recent session, then use the row's own wrench.
  // The phone lands on the SESSION list; the day (and its wrenches) is one level in.
  const session = page.getByText(/\d+ runs? · best/i).first();
  await session.click();
  await page.waitForTimeout(2500);
  const wrench = page.locator('button[aria-label^="View setup sheet for"]:visible');
  await page.screenshot({ path: OUT + "/02-day.png", fullPage: true });

  const count = await wrench.count();
  console.log("  wrenches on screen:", count);
  if (count === 0) throw new Error("no gutter wrench found — the day did not open");
  console.log("  using:", await wrench.first().getAttribute("aria-label"));
  await wrench.first().click();
  // The modal is lazy AND waits on `/api/runs/for-setup-compare` plus the page image.
  await page.waitForSelector('[role="dialog"]', { timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: OUT + "/03-sheet.png" });

  const editToggle = page.getByRole("button", { name: /^Edit setup$/i }).first();
  console.log("  Edit setup toggle present:", (await editToggle.count()) > 0);
  await editToggle.click();
  await page.waitForTimeout(1500);

  const labels = await page
    .locator("[data-sheet-box]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  const camber = labels.filter((l) => /camber/i.test(l));
  console.log("  camber boxes:", JSON.stringify(camber));
  if (camber.length < 2) throw new Error("Could not find both camber boxes.");
  await fillBox(page, camber[0], EDITS[0].next);
  await fillBox(page, camber[1], EDITS[1].next);
  await page.screenshot({ path: OUT + "/04-typed.png" });

  await page.getByRole("button", { name: /Correct this run/i }).first().click();
  let sawSheet = true;
  try {
    await page.waitForSelector("[data-cascade-sheet]", { timeout: 15000 });
  } catch {
    sawSheet = false;
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + "/05-question.png", fullPage: true });
  console.log("\n  >>> CASCADE QUESTION SHEET APPEARED? " + (sawSheet ? "YES" : "NO — still broken"));

  if (sawSheet) {
    const counter = (await page.locator("[data-cascade-sheet] p").first().textContent())?.trim();
    const rows = page.locator("[data-cascade-sheet] button[aria-pressed]");
    console.log('  Q1 "' + counter + '"  candidates=' + (await rows.count()));
    const first = rows.first();
    if ((await first.count()) && (await first.getAttribute("aria-pressed")) === "false") await first.click();
    await page.waitForTimeout(250);
    console.log('  Q1 button: "' + (await fixButton(page).textContent())?.trim() + '"');
    await fixButton(page).click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: OUT + "/06-q2.png", fullPage: true });
    const q2 = (await fixButton(page).textContent())?.trim();
    console.log('  Q2 button: "' + q2 + '"  stuck=' + /Fixing/.test(q2 ?? ""));
    const body = await page.locator("body").innerText();
    console.log("  toast:", body.split("\n").find((l) => /fixed on|already said|couldn/i.test(l)) ?? "(none)");
  }

  await browser.close();

  const after = await readState(user.id);
  const beforeById = new Map(before.map((b) => [b.runId, b]));
  let changed = 0;
  for (const a of after) {
    const b = beforeById.get(a.runId);
    if (!b) continue;
    for (const e of EDITS) {
      if (a.values[e.key] !== b.values[e.key]) {
        console.log("  " + a.runId + " " + e.key + ": " + b.values[e.key] + " → " + a.values[e.key]);
        changed++;
      }
    }
  }
  console.log("\nVERDICT  sheet=" + sawSheet + "  values written=" + changed);

  if (process.env.RESTORE !== "0") {
    let restored = 0;
    for (const a of after) {
      const b = beforeById.get(a.runId);
      if (!b) continue;
      const diff = EDITS.filter((e) => a.values[e.key] !== b.values[e.key]);
      if (diff.length === 0 || !a.snapshotId) continue;
      const rowData = await prisma.setupSnapshot.findUniqueOrThrow({
        where: { id: a.snapshotId },
        select: { data: true },
      });
      const data = normalizeSetupSnapshotForStorage(rowData.data);
      for (const e of diff) {
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
