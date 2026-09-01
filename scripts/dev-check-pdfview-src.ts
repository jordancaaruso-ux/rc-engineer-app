import { chromium } from "@playwright/test";

const BASE = "http://localhost:3000";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${BASE}/api/auth/dev-signin?email=jordancaaruso@gmail.com&to=/`);
  await page.waitForLoadState("networkidle");
  for (const [label, url] of [
    ["snapshot pdf", `${BASE}/api/setup-snapshots/cmth6je3n002jvle4wrxseq9m/setup-pdf`],
    ["viewer page", `${BASE}/pdf-view?snapshot=cmth6je3n002jvle4wrxseq9m`],
    ["viewer 404 (bogus id)", `${BASE}/pdf-view?snapshot=zzzzzzzzzzzzzzzzzzzzzzzzz`],
    ["viewer 404 (no params)", `${BASE}/pdf-view`],
  ] as const) {
    const res = await page.request.get(url);
    const type = res.headers()["content-type"] ?? "?";
    console.log(`${label}: ${res.status()} ${type.split(";")[0]}`);
  }
  await browser.close();
}

main();
