import { chromium, devices } from "@playwright/test";

/**
 * Dev rig: the Download button on a TOUCH device with no share sheet.
 *
 * Chromium emulating an iPhone has a coarse pointer and no `navigator.canShare` for files — the
 * same shape as the iPhone in the founder's hand on 2026-09-01. It must hand off to the server's
 * attachment URL (a real download), never the blob anchor that navigates and saves nothing, and
 * it must not claim "Saved to your downloads".
 */
const BASE = "http://localhost:3000";
const RAW = process.argv[2] ?? "cars/cmpw8xx4a0005le04l8uwg99u/setups/cmthx13lg00qhvlck1uxlawg9";
const PAGE = RAW.startsWith("/") ? RAW : `/${RAW}`;

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices["iPhone 13"], acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/api/auth/dev-signin?email=jordancaaruso@gmail.com`);
  await page.goto(`${BASE}${PAGE}`);
  await page.waitForLoadState("networkidle");

  // Make the emulation honest: an iPhone browser that refuses file sharing.
  await page.evaluate(() => {
    // @ts-expect-error - deleting for the test
    delete navigator.canShare;
    // @ts-expect-error - deleting for the test
    delete navigator.share;
  });

  const coarse = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
  const button = page.getByRole("button", { name: "Download" });
  await button.waitFor({ state: "visible" });

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    button.click(),
  ]);
  const url = download.url();
  await page.waitForTimeout(1500);
  const stillOnPage = page.url().includes("/setups/");
  const claimsSaved = await page.getByText("Saved to your downloads.").count();

  console.log(`coarse pointer: ${coarse} (want true)`);
  console.log(`download came from: ${url}`);
  console.log(`server attachment URL (not blob:): ${!url.startsWith("blob:")}`);
  console.log(`still on the setup page: ${stillOnPage}`);
  console.log(`falsely claims "Saved to your downloads": ${claimsSaved > 0} (want false)`);
  console.log(
    coarse && !url.startsWith("blob:") && url.includes("download=1") && stillOnPage && claimsSaved === 0
      ? "PASS"
      : "FAIL"
  );
  await browser.close();
}

main();
