import { chromium } from "@playwright/test";

const OUT = String.raw`C:\Users\Jordan\AppData\Local\Temp\claude\c--Users-Jordan-rc-engineer-app\c000bdfb-2a4a-4c9d-95a4-1d935a0ab9d4\scratchpad\drive`;
const BASE = "http://localhost:3000";
const SETUP_PATH = "/cars/cmpw8xx4a0005le04l8uwg99u/setups/cmth6je3n002jvle4wrxseq9m";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/api/auth/dev-signin?email=jordancaaruso@gmail.com&to=${encodeURIComponent(SETUP_PATH)}`);
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "More" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/pdfdoor-01-sheet.png` });
  await page.getByText("View as PDF", { exact: true }).click();
  await page.waitForURL(/\/pdf-view\?/);
  console.log("landed:", page.url());
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/pdfdoor-02-viewer.png` });

  await page.getByLabel("Back").first().click();
  await page.waitForURL((u) => u.pathname.includes("/setups/"));
  console.log("back to:", page.url());

  // And the Original PDF door.
  await page.getByRole("button", { name: "More" }).click();
  await page.waitForTimeout(500);
  await page.getByText("Original PDF", { exact: true }).click();
  await page.waitForURL(/\/pdf-view\?document=/);
  console.log("original landed:", page.url());
  await page.getByLabel("Back").first().click();
  await page.waitForURL((u) => u.pathname.includes("/setups/"));
  console.log("back again:", page.url());

  await browser.close();
}

main();
