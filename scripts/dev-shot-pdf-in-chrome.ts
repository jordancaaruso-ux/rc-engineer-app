import { chromium } from "@playwright/test";

/** Dev rig: what Chrome's own PDF viewer (PDFium) makes of an exported sheet. */
async function main() {
  const src = process.argv[2]!;
  const out = process.argv[3]!;
  const browser = await chromium.launch({ headless: false, args: ["--force-device-scale-factor=1.5"] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
  await page.goto(`file:///${src.split(String.fromCharCode(92)).join("/")}`);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: out });
  await browser.close();
  console.log("shot ->", out);
}
main();
