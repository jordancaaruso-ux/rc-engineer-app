/**
 * dev-cleared-box-doors.ts — DEV ONLY, throwaway.
 *
 * Does "emptying a box doesn't stick" exist beyond the log-run wizard? Drives the run's
 * own Setup face (the wrench on /analysis), which saves by a different route entirely.
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

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await ctx.newPage();
  const patches: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "PATCH" && r.method() !== "POST") return;
    if (!/setup-snapshot|setup-snapshots|setup-correction/.test(r.url())) return;
    let b: any = {};
    try { b = JSON.parse(r.postData() || "{}"); } catch {}
    const d = (b.setupData ?? b.data ?? {}) as Record<string, unknown>;
    const empties = Object.entries(d).filter(([, v]) => v === "").map(([k]) => k);
    patches.push(
      `${r.method()} ${new URL(r.url()).pathname} keys=${Object.keys(d).length} ` +
      `emptyMarkers=${empties.length ? empties.join("|") : "NONE"}`
    );
  });
  await page.goto(await mintSignInUrl(), { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});

  console.log("=== DOOR: the wrench on /analysis — a run's own Setup face");
  await page.goto(BASE + "/analysis", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2000);
  const wrench = page.getByRole("button", { name: /view setup sheet for/i }).first();
  console.log("  wrenches on the page: " + (await page.getByRole("button", { name: /view setup sheet for/i }).count()));
  if (!(await wrench.count())) {
    await page.screenshot({ path: OUT + "/60-no-wrench.png", fullPage: true });
    console.log("  !! no wrench found — see 60-no-wrench.png");
    await browser.close();
    return;
  }
  await wrench.click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: OUT + "/61-setup-face.png", fullPage: true });

  const edit = page.getByRole("button", { name: /^Edit$/ }).first();
  if (await edit.count()) { await edit.click(); await page.waitForTimeout(1800); }
  else console.log("  !! no Edit toggle");

  const boxes = page.locator("[data-sheet-box]");
  const n = await boxes.count();
  console.log("  sheet boxes: " + n);
  let label = "", was = "";
  for (let i = 0; i < n; i++) {
    const t = (await boxes.nth(i).innerText()).replace(/\s+/g, " ").trim();
    if (t && /[a-z]/i.test(t) && !/^-?[\d.]+$/.test(t)) {
      label = (await boxes.nth(i).getAttribute("aria-label")) ?? "";
      was = t;
      if (label) break;
    }
  }
  console.log("  clearing " + JSON.stringify(label) + " = " + JSON.stringify(was));
  const box = page.locator('[data-sheet-box][aria-label="' + label + '"]').first();
  await box.click();
  await page.waitForTimeout(600);
  const editor = page.locator("[data-persistent-editor]").first();
  await editor.fill("");
  await editor.press("Enter");
  await page.waitForTimeout(900);
  console.log("  sheet now shows " + JSON.stringify((await box.innerText()).replace(/\s+/g, " ").trim()));
  await page.screenshot({ path: OUT + "/62-cleared.png", fullPage: true });

  const saveBar = page.getByRole("button", { name: /correct this run|save/i }).first();
  console.log("  save control: " + (await saveBar.count() ? JSON.stringify((await saveBar.innerText()).trim()) : "NOT FOUND"));
  if (await saveBar.count()) { await saveBar.click(); await page.waitForTimeout(4500); }
  await page.screenshot({ path: OUT + "/63-saved.png", fullPage: true });
  console.log("  requests: " + (patches.length ? patches.join(" | ") : "NONE"));

  // Re-open cold and read the same box back.
  await page.goto(BASE + "/analysis", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /view setup sheet for/i }).first().click();
  await page.waitForTimeout(3000);
  const after = (await page.locator('[data-sheet-box][aria-label="' + label + '"]').first().innerText())
    .replace(/\s+/g, " ").trim();
  await page.screenshot({ path: OUT + "/64-reopened.png", fullPage: true });

  console.log("\n---------------- VERDICT (Setup face) ----------------");
  console.log("  box " + label + ": was " + JSON.stringify(was) + " -> reopened as " + JSON.stringify(after));
  console.log(after === "" ? "  => the clearing STUCK here." : "  => ALSO BROKEN: the old value came back.");
  await browser.close();
}
main().finally(() => prisma.$disconnect());
