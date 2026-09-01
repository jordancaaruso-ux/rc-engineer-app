import { chromium } from "@playwright/test";

const OUT = String.raw`C:\Users\Jordan\AppData\Local\Temp\claude\c--Users-Jordan-rc-engineer-app\c000bdfb-2a4a-4c9d-95a4-1d935a0ab9d4\scratchpad\drive`;
const BASE = "http://localhost:3000";
const to = process.argv[2] ?? "/";
const tag = process.argv[3] ?? "mobile";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${BASE}/api/auth/dev-signin?email=jordancaaruso@gmail.com&to=${encodeURIComponent(to)}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/${tag}.png` });
  console.log(`${OUT}\\${tag}.png`);
  await browser.close();
}

main();
