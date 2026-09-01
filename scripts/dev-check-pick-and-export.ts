/** Verify the stamped pick API and the edition PDF export, as a signed-in user. */
import { chromium } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

const BASE = "http://localhost:3000";
const SNAP = "cmth6je3n002jvle4wrxseq9m";
const MODEL = "cmpg8ad3x0001l804rbnhng5f";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${BASE}/api/auth/dev-signin?email=jordancaaruso@gmail.com&to=/`);
  await page.waitForLoadState("networkidle");

  const pickStamped = await page.request.get(
    `${BASE}/api/setup-sheet-models/${MODEL}/sheet-blank-pick?keys=camber_front,ride_height_front&snapshot=${SNAP}`
  );
  console.log("pick WITH stamp:", await pickStamped.text());
  const pickKeys = await page.request.get(
    `${BASE}/api/setup-sheet-models/${MODEL}/sheet-blank-pick?keys=camber_front,ride_height_front`
  );
  console.log("pick keys-only:", await pickKeys.text());

  const pdfRes = await page.request.get(`${BASE}/api/setup-snapshots/${SNAP}/setup-pdf`);
  console.log("export pdf status:", pdfRes.status());
  if (pdfRes.ok()) {
    const bytes = await pdfRes.body();
    const doc = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true });
    const form = doc.getForm();
    const names = form.getFields().map((f) => f.getName());
    const isNewPaper = names.includes("Front Camber");
    console.log(`export paper: ${isNewPaper ? "NEW (edition)" : "old"}; fields=${names.length}`);
    for (const n of ["Front Camber", "Front Ride Height", "Front Spring Rate", "Bodyshell", "Best Lap Time"]) {
      try {
        console.log(`  ${n} = ${form.getTextField(n).getText()}`);
      } catch {
        console.log(`  ${n} = (not a text field / missing)`);
      }
    }
  }
  await browser.close();
}

main();
