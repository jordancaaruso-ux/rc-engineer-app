import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * The Geometry Lab's sheet mode and its way back to a setup, on a real A800RR.
 *
 * Three claims, none of which a typecheck can make:
 *   1. A deep link from a sheet reaches the Lab carrying enough to DRAW that sheet.
 *   2. The sheet draws the WHOLE setup, not the nineteen geometry keys the URL carries — the
 *      failure this guards against is a driver seeing their own paper with 260 boxes rubbed out.
 *   3. A save merges. Geometry moves; springs, diffs and tyres are still there afterwards.
 *
 * Uses the founder's own dev account, because a throwaway has no A800RR:
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-fresh-onboarding.ts --email=<your address>
 *   RC_SIGNIN_URL="<the printed url>" npx playwright test e2e/roll-center-lab-sheet.spec.ts \
 *     --project=mobile-chromium
 */

const OUT = "roll-center-lab-sheet-shots";
mkdirSync(OUT, { recursive: true });

const SIGNIN = process.env.RC_SIGNIN_URL;
const CAR = process.env.RC_CAR_ID ?? "cmpw8xx4a0005le04l8uwg99u";
const SETUP = process.env.RC_SETUP_ID ?? "cmso9l7dd00vqvlxg8z1hm7jl";

const STRIP = "[data-testid='sheet-geometry-strip']";

/** Everything the Lab's URL slice carries — anything else on the sheet proves the fetch happened. */
const GEOMETRY_KEYS = new Set([
  "under_lower_arm_shims_ff", "under_lower_arm_shims_fr", "under_lower_arm_shims_rf",
  "under_lower_arm_shims_rr", "upper_inner_shims_ff", "upper_inner_shims_fr",
  "upper_inner_shims_rf", "upper_inner_shims_rr", "under_hub_shims_front",
  "under_hub_shims_rear", "upper_outer_shims_front", "upper_outer_shims_rear",
  "ride_height_front", "ride_height_rear", "camber_front", "camber_rear",
  "wheel_spacer_front", "wheel_spacer_rear", "chassis",
]);

test.use({ storageState: { cookies: [], origins: [] } });

/*
 * One sign-in for the whole file. The minted link is single-use, so a per-test `goto(SIGNIN)` burns
 * it on the first test and lands every later one on /login — which shows up as a confusing assertion
 * failure deep in the spec rather than as "you are not signed in". Signing in once into a shared
 * context is the only arrangement that survives more than one test per token.
 */
test.describe.configure({ mode: "serial" });

let ctx: import("@playwright/test").BrowserContext;
let page: import("@playwright/test").Page;

test.beforeAll(async ({ browser }) => {
  test.skip(!SIGNIN, "set RC_SIGNIN_URL to a freshly minted sign-in link");
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page = await ctx.newPage();
  await page.goto(SIGNIN!);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
});

test.afterAll(async () => {
  await ctx?.close();
});

test("Lab draws the whole sheet and saves back without erasing it", async () => {
  test.skip(!SIGNIN, "set RC_SIGNIN_URL to a freshly minted sign-in link");

  // What the row actually is decides what the Lab may offer, so read it rather than assume.
  const before = await (await page.request.get(`/api/setup-snapshots/${SETUP}`)).json();
  const setup = before.setup as {
    data: Record<string, unknown>;
    runCount: number;
    setupSheetModelId: string | null;
  };
  console.log(
    `  setup: runCount=${setup.runCount} model=${setup.setupSheetModelId} keys=${Object.keys(setup.data).length}`
  );
  expect(setup.setupSheetModelId, "this car must draw as a sheet for the test to mean anything").toBeTruthy();

  // A non-geometry value that must survive the round trip untouched.
  const witness = Object.entries(setup.data).find(
    ([k, v]) => !GEOMETRY_KEYS.has(k) && typeof v === "string" && v.trim().length > 0
  ) as [string, string] | undefined;
  expect(witness, "need at least one non-geometry value to prove the merge").toBeTruthy();
  console.log(`  witness: ${witness![0]} = ${JSON.stringify(witness![1])}`);

  // ── 1. Sheet → Lab, through the real deep link ──────────────────────────
  await page.goto(`/cars/${CAR}/setups/${SETUP}`);
  const strip = page.locator(STRIP);
  await expect(strip).toBeVisible({ timeout: 30_000 });
  await strip.locator("button").first().click();
  await strip.getByRole("link", { name: "Open in Lab" }).click();
  await expect(page).toHaveURL(/\/analysis\/roll-center/, { timeout: 30_000 });

  // The toggle only renders once the chassis AND the whole snapshot are in hand.
  // `SegmentedControl` is a radiogroup, not a row of buttons — see its own note on why.
  const sheetTab = page.getByRole("radio", { name: "Sheet", exact: true });
  await expect(sheetTab, "Knobs/Sheet toggle means the Lab knows its chassis").toBeVisible({
    timeout: 30_000,
  });

  /*
   * KNOBS IS THE DEFAULT, always (founder, 2026-08-14).
   *
   * The Lab opens on the fast surface. Four sliders beat panning a page picture to find one box,
   * and that is what a driver is doing between runs — the sheet is the deliberate second choice,
   * never what you land on. There is no persistence behind the toggle on purpose: every visit to
   * the Lab starts here, whatever was picked last time.
   */
  await expect(page.getByRole("radio", { name: "Knobs", exact: true })).toBeChecked();
  await expect(sheetTab, "the Lab must never open on the sheet").not.toBeChecked();
  await expect(
    page.locator("input[type='number'][aria-label^='Under hub']").first(),
    "knob rows are what a driver lands on"
  ).toBeVisible();
  await page.screenshot({ path: `${OUT}/01-lab-knobs.png`, fullPage: true });

  const rcFront = page.locator("div", { has: page.locator("div.type-data-label", { hasText: "RC front" }) });
  const readRc = async () =>
    (await page.locator("div.type-data-label", { hasText: "RC front" }).locator("..").innerText()).trim();
  const rcBefore = await readRc();

  // ── 2. The sheet draws the WHOLE setup ──────────────────────────────────
  await sheetTab.click();
  await page.waitForTimeout(2500); // server-rendered page raster + box plan fetch
  await page.screenshot({ path: `${OUT}/02-lab-sheet.png`, fullPage: true });

  const boxCount = await page.getByRole("button", { name: /·/ }).count();
  console.log(`  sheet boxes rendered: ${boxCount}`);
  expect(boxCount, "a real sheet is hundreds of boxes, not nineteen").toBeGreaterThan(50);

  // The witness value is drawn on the paper — proof the Lab fetched past its URL slice.
  await expect(
    page.getByText(witness![1], { exact: false }).first(),
    `non-geometry value ${witness![0]} must be drawn on the sheet`
  ).toBeVisible({ timeout: 15_000 });

  // ── 3. Edit geometry, back on the knobs, and watch the number move ──────
  await page.getByRole("radio", { name: "Knobs", exact: true }).click();
  const underHub = page.locator("input[type='number'][aria-label^='Under hub']").first();
  await expect(underHub).toBeVisible();
  const hubBefore = await underHub.inputValue();
  await underHub.fill(String((Number(hubBefore) || 0) + 0.5));
  await underHub.blur();
  await page.waitForTimeout(400);
  const rcAfter = await readRc();
  console.log(`  RC front: ${rcBefore.replace(/\s+/g, " ")} → ${rcAfter.replace(/\s+/g, " ")}`);
  expect(rcAfter, "adding under-hub shim must move the front roll centre").not.toBe(rcBefore);
  await page.screenshot({ path: `${OUT}/03-lab-edited.png`, fullPage: true });

  // ── 4. The way out, labelled by what this row is ────────────────────────
  const saveBtn = page.getByRole("button", { name: /Save to this setup|Correct this run/ });
  const nextRun = page.getByRole("link", { name: "Use for next run" });
  await expect(nextRun, "the run prefill is the universal exit and always exists").toBeVisible();

  if (setup.runCount > 0) {
    // A run's record: writable only as a correction, never in place. No in-place door may appear.
    await expect(page.getByRole("button", { name: "Save to this setup" })).toHaveCount(0);
    console.log("  runCount > 0 — in-place save correctly absent");
    await page.screenshot({ path: `${OUT}/04-lab-no-inplace.png`, fullPage: true });
    return;
  }

  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();
  await expect(page.getByText(/Saved to this setup|Run corrected/)).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${OUT}/04-lab-saved.png`, fullPage: true });

  // ── 5. THE MERGE TRAP: geometry moved, everything else survived ─────────
  const after = await (await page.request.get(`/api/setup-snapshots/${SETUP}`)).json();
  const afterData = after.setup.data as Record<string, unknown>;
  expect(String(afterData.under_hub_shims_front)).toBe(String((Number(hubBefore) || 0) + 0.5));
  expect(afterData[witness![0]], "the non-geometry value must be untouched").toEqual(witness![1]);
  expect(
    Object.keys(afterData).length,
    "saving must not shrink the setup to its geometry slice"
  ).toBeGreaterThanOrEqual(Object.keys(setup.data).length);
  console.log(`  after save: keys=${Object.keys(afterData).length}, witness intact`);

  // Put the shim back so a re-run starts where this one did.
  await page.request.patch(`/api/setup-snapshots/${SETUP}`, {
    data: { data: { ...afterData, under_hub_shims_front: hubBefore } },
  });
  expect(rcFront).toBeDefined();
});

test("a run's own setup offers a correction, never an overwrite", async () => {
  test.skip(!SIGNIN, "set RC_SIGNIN_URL to a freshly minted sign-in link");

  // Straight into the Lab and in through its own picker — the other half of the wiring, where the
  // chassis and the write target come from the picker rows rather than a deep link.
  await page.goto("/analysis/roll-center");
  await page.getByPlaceholder(/Search setups/).click();
  const runRow = page.getByRole("button", { name: /^run / }).first();
  await expect(runRow, "the Mine tab lists this account's runs").toBeVisible({ timeout: 30_000 });
  await runRow.click();

  // Same two capabilities as the deep link: the sheet is drawable, and knobs are still what you
  // land on — the default holds however the setup arrived, picker or link.
  await expect(page.getByRole("radio", { name: "Sheet", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("radio", { name: "Knobs", exact: true })).toBeChecked();

  // ...and the save door is the run-shaped one. A run's snapshot IS what that run raced, so the
  // in-place write must not be offered at all — not offered-then-409.
  const underHub = page.locator("input[type='number'][aria-label^='Under hub']").first();
  await underHub.fill(String((Number(await underHub.inputValue()) || 0) + 0.5));
  await underHub.blur();
  await page.waitForTimeout(400);

  await expect(page.getByRole("button", { name: "Correct this run" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save to this setup" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Use for next run" })).toBeVisible();
  await page.screenshot({ path: `${OUT}/05-run-correction-only.png`, fullPage: true });
});
