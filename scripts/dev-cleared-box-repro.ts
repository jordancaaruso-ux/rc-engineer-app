/**
 * dev-cleared-box-repro.ts — DEV ONLY, throwaway.
 *
 * The user's report, exactly as filmed (2026-08-25): on the log-run sheet he EMPTIES a
 * text box, finishes the run, and on the next run the old value is back.
 *
 * Phase 1: the log-run wizard. Prefill (so the run has a baseline), clear a box, complete
 * the run, then start the next run and read the same box.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";

const BASE = process.env.REPRO_BASE ?? "http://localhost:3000";
const EMAIL = "jordancaaruso@gmail.com";
const OUT = process.env.REPRO_OUT!;

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

async function openSetupStep(page: Page) {
  await page.goto(BASE + "/runs/new", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByRole("button", { name: /prefill this run/i }).click();
  await page.waitForTimeout(1600);
  await page.getByRole("button", { name: /^Setup\b/ }).first().click();
  await page.waitForTimeout(2800);
}

/** Every filled box on the sheet, label -> what it reads. */
async function readSheet(page: Page): Promise<Map<string, string>> {
  const boxes = page.locator("[data-sheet-box]");
  const n = await boxes.count();
  const out = new Map<string, string>();
  for (let i = 0; i < n; i++) {
    const b = boxes.nth(i);
    const label = (await b.getAttribute("aria-label")) ?? `box${i}`;
    const text = (await b.innerText()).replace(/\s+/g, " ").trim();
    if (text) out.set(label, text);
  }
  return out;
}

async function newestRun(userId: string) {
  return prisma.run.findFirst({
    where: { userId },
    orderBy: { sortAt: "desc" },
    select: {
      id: true, loggingComplete: true, sortAt: true,
      setupSnapshot: { select: { id: true, baseSetupSnapshotId: true, data: true } },
    },
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const user = await prisma.user.findFirstOrThrow({ where: { email: EMAIL }, select: { id: true } });
  const before = await newestRun(user.id);
  console.log("start: newest run " + before?.id.slice(0, 8) + " snap " + before?.setupSnapshot?.id.slice(0, 8));

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  let lastPost: any = null;
  page.on("request", (r) => {
    if (r.method() !== "POST" || !r.url().includes("/api/runs")) return;
    try { lastPost = JSON.parse(r.postData() || "{}"); } catch { lastPost = null; }
  });

  await page.goto(await mintSignInUrl(), { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});

  console.log("\n=== RUN A — prefill, then EMPTY a box");
  await openSetupStep(page);
  const filled = await readSheet(page);
  console.log("  boxes with something in them: " + filled.size);

  // Prefer a box holding WORDS, like his "long" — that is what he cleared on camera.
  const wordy = [...filled.entries()].filter(([, v]) => /[a-z]/i.test(v) && !/^-?[\d.]+$/.test(v));
  const [label, was] = (wordy[0] ?? [...filled.entries()][0]) as [string, string];
  console.log("  clearing: " + JSON.stringify(label) + " which reads " + JSON.stringify(was));
  console.log("  (other wordy boxes: " + wordy.slice(1, 5).map(([l, v]) => `${l}=${v}`).join(", ") + ")");

  const box = page.locator('[data-sheet-box][aria-label="' + label + '"]').first();
  await box.click();
  await page.waitForTimeout(500);
  const editor = page.locator("[data-persistent-editor]").first();
  await editor.fill("");
  await editor.press("Enter");
  await page.waitForTimeout(900);
  const afterClear = (await box.innerText()).replace(/\s+/g, " ").trim();
  console.log("  sheet now shows: " + JSON.stringify(afterClear));
  await page.screenshot({ path: OUT + "/50-cleared.png", fullPage: true });

  // Finish the run the way he does: walk to the end, rate it, Complete.
  for (let i = 0; i < 6; i++) {
    const next = page.getByRole("button", { name: /^Next\b/ }).first();
    if (!(await next.count()) || !(await next.isVisible().catch(() => false))) break;
    await next.click();
    await page.waitForTimeout(1500);
  }
  const rating = page.locator("button", { hasText: /^7$/ }).first();
  if (await rating.count()) { await rating.click(); await page.waitForTimeout(700); }
  const complete = page.getByRole("button", { name: /^Complete$/ }).first();
  if (await complete.count()) { await complete.click(); await page.waitForTimeout(4000); }
  else console.log("  !! no Complete button");

  const runA = await newestRun(user.id);
  const key = Object.keys((runA?.setupSnapshot?.data ?? {}) as Record<string, unknown>);
  console.log("\n  RUN A: " + runA?.id.slice(0, 8) + " complete=" + runA?.loggingComplete +
    " base=" + (runA?.setupSnapshot?.baseSetupSnapshotId?.slice(0, 8) ?? "none") +
    " keys=" + key.length + (runA?.id === before?.id ? "   <-- NO NEW RUN" : ""));
  if (lastPost) {
    const sd = (lastPost.setupData ?? {}) as Record<string, unknown>;
    console.log("  POST /api/runs: baseline=" + String(lastPost.setupBaselineSnapshotId).slice(0, 8) +
      " setupData keys=" + Object.keys(sd).length);
    const emptyKeys = Object.entries(sd).filter(([, v]) => v === "").map(([k]) => k);
    console.log("  keys sent as an empty string (the deletion marker): " +
      (emptyKeys.length ? emptyKeys.join(", ") : "NONE"));
  }

  console.log("\n=== RUN B — the next run");
  await openSetupStep(page);
  const nowShows = (await page.locator('[data-sheet-box][aria-label="' + label + '"]').first().innerText())
    .replace(/\s+/g, " ").trim();
  await page.screenshot({ path: OUT + "/51-next-run.png", fullPage: true });

  console.log("\n---------------- VERDICT ----------------");
  console.log("  box            : " + label);
  console.log("  read before    : " + JSON.stringify(was));
  console.log("  after clearing : " + JSON.stringify(afterClear));
  console.log("  next run shows : " + JSON.stringify(nowShows));
  console.log(nowShows === "" ? "  => the clearing STUCK." : "  => REPRODUCED: the old value came back.");
  await browser.close();
}
main().finally(() => prisma.$disconnect());
