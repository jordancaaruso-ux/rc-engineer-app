import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

/**
 * The session view's Setup modal must never draw an empty sheet over a run that has values.
 *
 * WHAT BREAKS. The modal asks two questions at once: "does this car draw as a sheet" and "what
 * values did this run have". The sheet surface copies its values ONCE, at mount, on purpose — a
 * sheet being filled in must not have its boxes rewritten under the driver's fingers. So if the
 * first answer arrives before the second, the sheet mounts holding nothing and ignores the values
 * when they land: the driver gets their own paper with every box empty, and no error anywhere.
 *
 * Which answer wins is down to network timing, which is why this was intermittent in the wild.
 * Here the values request is deliberately held back so the losing order happens EVERY run.
 *
 * SINCE 2026-08-16 THE RACE HAS NO STARTING LINE. Both answers now ride one response — the modal
 * asks `/api/runs/[id]/setup-snapshot?sheet=1` and gets the surface AND the values together, because
 * the car route that used to answer the first question is owner-scoped and 404'd on a teammate's
 * car. The delay below now holds BOTH back, so the sheet cannot mount before its values exist.
 * These tests therefore no longer reproduce the ordering; they stand as the net that the modal draws
 * a run's values at all, at both doors, and that opening a second run never shows the first's.
 *
 * Seeds its own run on a chassis that draws as a sheet, and its own account to see it with — the
 * magic link is single use, so a spec that reused one would pass once and then land on /login.
 */

const FIXTURE = "e2e/.auth/sheet-run.json";
const OUT = "sheet-race-shots";
mkdirSync(OUT, { recursive: true });

/** Long enough that the sheet is up and settled before the values could possibly arrive. */
const VALUES_DELAY_MS = 2500;

// Signs in with its own minted link, so the suite's shared account is irrelevant here.
test.use({ storageState: { cookies: [], origins: [] } });

// Per test, not once per file: the magic link is single use, so the second test would otherwise
// sign in with a spent token and measure the login page.
test.beforeEach(() => {
  // Same invocation shape as `auth.setup.ts`: the module graph reaches `server-only`, and the
  // script reads the database from `.env.local` (scratch-dev — it refuses to run on production).
  const out = execFileSync(
    "npx",
    [
      "dotenv-cli",
      "-e",
      ".env.local",
      "--",
      "node",
      "--conditions=react-server",
      "--import",
      "tsx",
      "scripts/dev-seed-sheet-run.ts",
    ],
    { encoding: "utf8", shell: true, timeout: 180_000 }
  );
  console.log(out.split("\n").filter((l) => /Chassis|Setup:|Run:/.test(l)).join("\n"));
});

test("setup modal draws the run's values even when they arrive after the sheet", async ({ page }) => {
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as { signInUrl: string; runId: string };

  // Hold the values back. Everything else — the sheet model, the box list, the page picture —
  // answers at full speed, which is exactly the order that produced the blank sheet.
  await page.route("**/api/runs/*/setup-snapshot", async (route) => {
    await new Promise((r) => setTimeout(r, VALUES_DELAY_MS));
    await route.continue();
  });

  await page.goto(fixture.signInUrl);
  await page.waitForLoadState("networkidle");
  // Landing on /login means the token was refused, and every assertion below would then be
  // measuring the sign-in page rather than the sheet.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });

  await page.goto(`/runs/${fixture.runId}`);
  await page.getByRole("button", { name: "Setup", exact: true }).first().click({ timeout: 60_000 });

  // The boxes arrive with the box list, well before the values under the delay above.
  const boxes = page.locator("[data-sheet-box]");
  await expect(boxes.first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${OUT}/01-sheet-mounted.png`, fullPage: false });

  // Now wait past the delay, plus room for the request itself, and look at the paper.
  await page.waitForTimeout(VALUES_DELAY_MS + 2500);
  await page.screenshot({ path: `${OUT}/02-after-values-land.png`, fullPage: false });

  const drawn = await boxes.evaluateAll(
    (els) => els.filter((el) => (el.textContent ?? "").trim() !== "").length
  );
  console.log(`  boxes with a value drawn in them: ${drawn} of ${await boxes.count()}`);
  expect(drawn).toBeGreaterThan(20);
});

/**
 * The same race at the other door, plus a guard against showing the WRONG run's setup.
 *
 * The Analysis workbench keeps the day's runs and the run detail on one page, so two runs' setups
 * are opened one after the other without a page load. The values race bites here exactly as it does
 * on the run page (measured: 0 of 279 boxes before the fix, both doors).
 *
 * The mid-flight assertion is about a different failure: values fetched for the LAST run still
 * sitting in the modal when the NEXT one opens, which would draw another session's numbers on this
 * session's paper with nothing on screen to say so. This door does not reach it today — it unmounts
 * the modal on close, which clears the state — so that assertion passes with or without the reset in
 * `SetupSheetModal`. It is here because the door that CAN reach it (the lap-compare grid, which
 * keeps a non-null anchor run behind the modal) is not driveable without seeded lap times.
 */
test("opening a second run's setup never shows the first run's values", async ({ page }) => {
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    signInUrl: string;
    markerA: string;
    markerB: string;
  };

  await page.route("**/api/runs/*/setup-snapshot", async (route) => {
    await new Promise((r) => setTimeout(r, VALUES_DELAY_MS));
    await route.continue();
  });

  await page.goto(fixture.signInUrl);
  await page.waitForLoadState("networkidle");
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });

  // Desktop, so the workbench keeps the day's runs and the run detail on one page — which is what
  // makes this door "one modal, many runs" rather than a fresh page load per run.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/runs/history");

  /**
   * Pick a run out of the day card, then open its setup from the detail beside it. Rows are named
   * by the run ("Sheet repro A"), not the session label — a day of same-type runs shows names.
   */
  const openSetupFor = async (row: string) => {
    await page.getByText(row, { exact: true }).first().click({ timeout: 60_000 });
    await page.getByRole("button", { name: "Setup", exact: true }).first().click({ timeout: 60_000 });
  };
  const markersOnSheet = async () => {
    const texts = await page
      .locator("[data-sheet-box]")
      .evaluateAll((els) => els.map((el) => (el.textContent ?? "").trim()));
    return {
      a: texts.filter((t) => t === fixture.markerA).length,
      b: texts.filter((t) => t === fixture.markerB).length,
    };
  };

  // Which of the day's two runs is which marker is the list's business, not this test's: whichever
  // one the first row holds, the SECOND row must not be showing it.
  await openSetupFor("Sheet repro A");
  await expect(page.locator("[data-sheet-box]").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(VALUES_DELAY_MS + 2500);
  const first = await markersOnSheet();
  await page.screenshot({ path: `${OUT}/03-first-run-settled.png` });
  console.log(`  first run drew: ${first.a} AAA / ${first.b} BBB`);
  expect(Math.max(first.a, first.b)).toBeGreaterThan(20);
  const firstMarker: "a" | "b" = first.a > first.b ? "a" : "b";
  const secondMarker = firstMarker === "a" ? "b" : "a";

  await page.getByRole("button", { name: "Close" }).click();
  await openSetupFor("Sheet repro B");
  await expect(page.locator("[data-sheet-box]").first()).toBeVisible({ timeout: 30_000 });

  // Mid-flight: this run's values cannot have arrived yet, so the last run's must NOT be on the
  // paper — an empty sheet is honest here, another run's numbers are not.
  await page.waitForTimeout(Math.round(VALUES_DELAY_MS / 2));
  const midFlight = await markersOnSheet();
  await page.screenshot({ path: `${OUT}/04-second-run-mid-flight.png` });
  console.log(`  second run mid-flight: ${midFlight.a} AAA / ${midFlight.b} BBB`);
  expect(midFlight[firstMarker]).toBe(0);

  // And once they land, this run's own values are what is drawn.
  await page.waitForTimeout(VALUES_DELAY_MS + 2500);
  const settled = await markersOnSheet();
  await page.screenshot({ path: `${OUT}/05-second-run-settled.png` });
  console.log(`  second run settled: ${settled.a} AAA / ${settled.b} BBB`);
  expect(settled[secondMarker]).toBeGreaterThan(20);
  expect(settled[firstMarker]).toBe(0);
});
