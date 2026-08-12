import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * The geometry strip on a REAL A800RR car, on the real product surfaces.
 *
 * Distinct from `roll-center-strip.spec.ts`, which drives a scratch page because the repo carries
 * no A800RR blank. This one signs in as the founder's own dev account and opens his own sheets, so
 * what it captures is the shipped screen and nothing else.
 *
 * Needs a fresh single-use sign-in URL, because it deliberately does not use the suite's throwaway
 * account — a throwaway has no cars, and this is about a car that exists:
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-fresh-onboarding.ts --email=<your address>
 *   RC_SIGNIN_URL="<the printed url>" npx playwright test e2e/roll-center-real-sheet.spec.ts \
 *     --project=mobile-chromium
 */

const OUT = "roll-center-strip-shots";
mkdirSync(OUT, { recursive: true });

const SIGNIN = process.env.RC_SIGNIN_URL;
/** The founder's A800RR and one of its saved setups on the dev branch. */
const CAR = process.env.RC_CAR_ID ?? "cmpw8xx4a0005le04l8uwg99u";
const SETUP = process.env.RC_SETUP_ID ?? "cmso9l7dd00vqvlxg8z1hm7jl";

const STRIP = "[data-testid='sheet-geometry-strip']";

test.use({ storageState: { cookies: [], origins: [] } });

test("geometry strip on a real A800RR sheet", async ({ page }) => {
  test.skip(!SIGNIN, "set RC_SIGNIN_URL to a freshly minted sign-in link");

  await page.goto(SIGNIN!);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });

  // 1. Reading a saved setup — the setup view itself.
  await page.goto(`/cars/${CAR}/setups/${SETUP}`);
  const strip = page.locator(STRIP);
  await expect(strip).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500); // the sheet picture is a server-rendered raster
  await page.screenshot({ path: `${OUT}/real-01-setup-view.png` });

  await strip.locator("button").first().click();
  await expect(strip.getByRole("link", { name: "Open in Lab" })).toBeVisible();
  await page.screenshot({ path: `${OUT}/real-02-setup-view-open.png`, fullPage: true });
  console.log(`  setup view: ${(await strip.locator("button").first().innerText()).split("\n")[0]}`);

  // 2. Editing that setup — the same sheet, now with a cursor in it.
  await page.goto(`/cars/${CAR}/setups/${SETUP}/edit`);
  const editStrip = page.locator(STRIP);
  // A setup a run points at is history and redirects to the read view; either way the strip shows.
  await expect(editStrip).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/real-03-edit.png` });
  console.log(
    `  edit (${new URL(page.url()).pathname.endsWith("/edit") ? "editor" : "read view"}): ` +
      `${(await editStrip.locator("button").first().innerText()).split("\n")[0]}`
  );

  // 3. Filling a new setup on the same car — where the number moves as boxes are filled.
  await page.goto(`/cars/${CAR}/setups/new`);
  const fillStrip = page.locator(STRIP);
  await expect(fillStrip).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/real-04-new-fill.png` });
  console.log(`  new fill: ${(await fillStrip.locator("button").first().innerText()).split("\n")[0]}`);
});
