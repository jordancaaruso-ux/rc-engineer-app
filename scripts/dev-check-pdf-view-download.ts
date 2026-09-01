import path from "node:path";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

/** Dev rig: the in-app PDF viewer's own Download, on the file the driver uploaded. */
const OUT = String.raw`C:\Users\Jordan\AppData\Local\Temp\claude\c--Users-Jordan-rc-engineer-app\c000bdfb-2a4a-4c9d-95a4-1d935a0ab9d4\scratchpad\drive`;
const BASE = "http://localhost:3000";
const RAW = process.argv[2] ?? "cars/cmpw8xx4a0005le04l8uwg99u/setups/cmthx13lg00qhvlck1uxlawg9";
const PAGE = RAW.startsWith("/") ? RAW : `/${RAW}`;

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${BASE}/api/auth/dev-signin?email=jordancaaruso@gmail.com`);
  await page.goto(`${BASE}${PAGE}`);
  await page.waitForLoadState("networkidle");

  await page.getByRole("link", { name: "View original file" }).click();
  await page.waitForURL(/\/pdf-view/);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(OUT, "pdf-view-desktop.png") });

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.getByRole("button", { name: "Download" }).click(),
  ]);
  const file = path.join(OUT, "downloaded-original.pdf");
  await download.saveAs(file);
  const bytes = await readFile(file);
  console.log(
    `${download.suggestedFilename()} | ${bytes.length} bytes | ${bytes.subarray(0, 5).toString("latin1")}`
  );

  // And the way back out, which is why this page exists at all.
  await page.getByRole("link", { name: "Back" }).first().click();
  await page.waitForLoadState("networkidle");
  console.log(`back to: ${page.url()}`);
  await browser.close();
}

main();
