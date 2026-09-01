import { chromium } from "@playwright/test";

const OUT = String.raw`C:\Users\Jordan\AppData\Local\Temp\claude\c--Users-Jordan-rc-engineer-app\c000bdfb-2a4a-4c9d-95a4-1d935a0ab9d4\scratchpad\drive`;
const BASE = "http://localhost:3000";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(
    `${BASE}/api/auth/dev-signin?email=jordancaaruso@gmail.com&to=${encodeURIComponent(
      "/cars/cmpw8xx4a0005le04l8uwg99u/setups/cmth6je3n002jvle4wrxseq9m"
    )}`
  );
  await page.waitForLoadState("networkidle");
  await page.getByText("Compare", { exact: true }).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/compare-01-picker.png` });
  await page.getByText("Select setup…", { exact: false }).first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/compare-01b-options.png` });
  await page.getByText("15.905", { exact: false }).first().click();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}/compare-02-diff.png`, fullPage: false });
  console.log("done", page.url());
  await browser.close();
}

main();
