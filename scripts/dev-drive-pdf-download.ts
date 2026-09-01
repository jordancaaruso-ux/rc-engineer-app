import { chromium } from "@playwright/test";

const BASE = "http://localhost:3000";
const VIEW = "/pdf-view?snapshot=cmth6je3n002jvle4wrxseq9m&title=EC%20Luxembourg";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${BASE}/api/auth/dev-signin?email=jordancaaruso@gmail.com&to=${encodeURIComponent(VIEW)}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);

  const downloadPromise = page.waitForEvent("download", { timeout: 20000 });
  await page.getByRole("button", { name: "Download" }).click();
  const dl = await downloadPromise;
  console.log("download fired:", dl.suggestedFilename());
  await page.waitForTimeout(500);
  console.log("still on:", page.url());
  console.log("button now:", await page.getByRole("button", { name: /Download|Saved|Sent/ }).first().textContent());
  await browser.close();
}

main();
