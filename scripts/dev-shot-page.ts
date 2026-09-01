/** Screenshot a page as Jordan (dev-signin), with console errors printed. */
import { chromium } from "@playwright/test";

const OUT = String.raw`C:\Users\Jordan\AppData\Local\Temp\claude\c--Users-Jordan-rc-engineer-app\c000bdfb-2a4a-4c9d-95a4-1d935a0ab9d4\scratchpad\drive`;
const BASE = "http://localhost:3000";
const to = process.argv[2] ?? "/";
const tag = process.argv[3] ?? "page";
const email = process.argv[4] ?? "jordancaaruso@gmail.com";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log(`[console:${m.type()}] ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message.slice(0, 400)}`));
  await page.goto(`${BASE}/api/auth/dev-signin?email=${encodeURIComponent(email)}&to=${encodeURIComponent(to)}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/${tag}.png`, fullPage: true });
  console.log(`shot: ${OUT}\\${tag}.png url=${page.url()}`);
  await browser.close();
}

main();
