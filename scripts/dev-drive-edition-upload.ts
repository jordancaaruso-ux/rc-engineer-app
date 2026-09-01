/**
 * Drive the app: upload a filled copy of the NEW (Lucas) A800RR layout through the real UI door
 * and screenshot every step. Expects the dev server on localhost:3000 (scratch-dev DB).
 */
import path from "node:path";
import { chromium } from "@playwright/test";

const OUT = String.raw`C:\Users\Jordan\AppData\Local\Temp\claude\c--Users-Jordan-rc-engineer-app\c000bdfb-2a4a-4c9d-95a4-1d935a0ab9d4\scratchpad\drive`;
const BASE = "http://localhost:3000";
const FILE = process.argv[2] ?? path.resolve("scripts/tmp-lucas-setup2.pdf");
const CAR_NAME = process.argv[3] ?? "A800RR";
const TAG = process.argv[4] ?? "lucas";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(30000);

  await page.goto(`${BASE}/api/auth/dev-signin?email=jordancaaruso@gmail.com&to=/cars`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/${TAG}-01-cars.png` });

  await page.getByText("Create / Upload setup sheet", { exact: false }).first().click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${TAG}-02-sheet-open.png` });

  const dialog = page.locator('[role="dialog"][aria-label="Create or upload setup sheet"]');
  const carName = dialog.getByText(CAR_NAME, { exact: true }).first();
  if (await carName.isVisible().catch(() => false)) {
    await carName.click();
  }
  await dialog.getByText("Upload a sheet you've filled in").waitFor({ state: "visible" });
  await page.screenshot({ path: `${OUT}/${TAG}-03-doors.png` });

  await page.setInputFiles('input[type="file"]', FILE);
  await page.screenshot({ path: `${OUT}/${TAG}-04-uploading.png` });

  await page.waitForURL(/\/(cars\/.+\/setups\/.+|setup-documents\/.+)/, { timeout: 120000 });
  await page.waitForLoadState("networkidle");
  console.log(`landed on: ${page.url()}`);
  await page.screenshot({ path: `${OUT}/${TAG}-05-landing.png`, fullPage: true });

  await browser.close();
}

main();
