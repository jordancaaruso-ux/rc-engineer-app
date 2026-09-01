import path from "node:path";
import { chromium, devices } from "@playwright/test";

/** Dev rig: the setup page's action row at desktop and phone width. */
const OUT = String.raw`C:\Users\Jordan\AppData\Local\Temp\claude\c--Users-Jordan-rc-engineer-app\c000bdfb-2a4a-4c9d-95a4-1d935a0ab9d4\scratchpad\drive`;
const BASE = "http://localhost:3000";
// Pass the path WITHOUT its leading slash from Git Bash — MSYS rewrites "/cars/..." into a Windows
// path ("C:/Program Files/Git/cars/...") before node ever sees the argument.
const RAW = process.argv[2] ?? "cars/cmpw8xx4a0005le04l8uwg99u/setups/cmthx2yi400s8vlckug9pnrvr";
const PAGE = RAW.startsWith("/") ? RAW : `/${RAW}`;

async function shot(width: number, height: number, name: string, mobile: boolean) {
  const browser = await chromium.launch();
  const page = await browser.newPage(
    mobile ? { ...devices["iPhone 13"] } : { viewport: { width, height } }
  );
  await page.goto(`${BASE}/api/auth/dev-signin?email=jordancaaruso@gmail.com`);
  await page.waitForLoadState("networkidle");
  await page.goto(`${BASE}${PAGE}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);
  console.log(`${name}: ${page.url()}`);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  // Just the row, twice the size, so the glyphs are legible in the report.
  const row = page.locator("section.page-body .flex.flex-wrap.items-center").first();
  if (await row.count()) {
    await row.screenshot({ path: path.join(OUT, `${name}-row.png`), scale: "device" });
  }
  await browser.close();
}

async function main() {
  await shot(1440, 1100, "actions-desktop", false);
  await shot(390, 844, "actions-phone", true);
  console.log("done");
}

main();
