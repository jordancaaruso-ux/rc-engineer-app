import path from "node:path";
import { readFile } from "node:fs/promises";
import { chromium, devices } from "@playwright/test";

/**
 * Dev rig: press Download on a setup page and prove a PDF actually lands.
 *
 * Also asserts the rule that sends a desktop straight to a download instead of the OS share
 * dialog — `(pointer: coarse)` is what `useShareFiles` now tests (founder report, 2026-09-01).
 */
const OUT = String.raw`C:\Users\Jordan\AppData\Local\Temp\claude\c--Users-Jordan-rc-engineer-app\c000bdfb-2a4a-4c9d-95a4-1d935a0ab9d4\scratchpad\drive`;
const BASE = "http://localhost:3000";
const RAW = process.argv[2] ?? "cars/cmpw8xx4a0005le04l8uwg99u/setups/cmthx13lg00qhvlck1uxlawg9";
const PAGE = RAW.startsWith("/") ? RAW : `/${RAW}`;

async function main() {
  const browser = await chromium.launch();

  // Desktop: fine pointer, so the button must hand over the file itself.
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await desktop.goto(`${BASE}/api/auth/dev-signin?email=jordancaaruso@gmail.com`);
  await desktop.goto(`${BASE}${PAGE}`);
  await desktop.waitForLoadState("networkidle");
  const coarseDesktop = await desktop.evaluate(
    () => window.matchMedia("(pointer: coarse)").matches
  );

  const button = desktop.getByRole("button", { name: "Download" });
  await button.waitFor({ state: "visible" });
  const [download] = await Promise.all([
    desktop.waitForEvent("download", { timeout: 60_000 }),
    button.click(),
  ]);
  const file = path.join(OUT, "downloaded.pdf");
  await download.saveAs(file);
  const bytes = await readFile(file);
  const header = bytes.subarray(0, 5).toString("latin1");

  // Phone: coarse pointer, so the same button reaches for the OS share sheet.
  const phone = await browser.newPage({ ...devices["iPhone 13"] });
  const coarsePhone = await phone.evaluate(() => window.matchMedia("(pointer: coarse)").matches);

  console.log(`pointer coarse — desktop: ${coarseDesktop} (want false), phone: ${coarsePhone} (want true)`);
  console.log(`downloaded: ${download.suggestedFilename()} | ${bytes.length} bytes | header ${header}`);
  console.log(
    coarseDesktop === false && coarsePhone === true && header === "%PDF-" && bytes.length > 20_000
      ? "PASS"
      : "FAIL"
  );

  await browser.close();
}

main();
