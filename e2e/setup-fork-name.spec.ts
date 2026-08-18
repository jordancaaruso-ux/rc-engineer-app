import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * "Save as new setup" asks what to call the copy, and the copy is on the car page immediately.
 *
 * Both halves were reported from the app on 2026-08-17: the fork named itself "<source> (edited)"
 * and offered a Rename link afterwards, and the new setup didn't appear on the car page until a
 * full reload. See `useSetupEditorSave` for why each changed.
 *
 * ============================== WHY THIS DOESN'T USE THE PDF FIXTURE ==============================
 *
 * `setup-edit-doors.spec.ts` builds its setups by uploading a real sheet, and it carries the same
 * name-sheet assertions. But three of its five tests currently die in `editableKey` — the X4 fixture
 * parses to an empty `parsedDataJson` on a fresh account here, which is a parser/calibration problem
 * with nothing to do with the editor. Setups made straight through `POST /api/setup-snapshots` reach
 * the identical editor and the identical save bar, so this suite pins the doors without depending on
 * a PDF being read correctly first.
 */

async function makeCar(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post("/api/cars", { data: { name } });
  expect(res.status(), await res.text()).toBeLessThan(400);
  return ((await res.json()) as { car: { id: string } }).car.id;
}

async function makeSetup(
  request: APIRequestContext,
  carId: string,
  values: Record<string, string>
): Promise<string> {
  const res = await request.post("/api/setup-snapshots", {
    data: { carId, name: "Mod A", data: values },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { setup: { id: string } }).setup.id;
}

const VALUES = { camber_front: "-1.5", ride_height_rear: "6.0" };

test("the fork asks for a name, and the copy reaches the car page without a reload", async ({
  page,
  request,
}) => {
  const carId = await makeCar(request, "Fork name test");
  const setupId = await makeSetup(request, carId, VALUES);

  // Nothing has raced these numbers, so this is the in-place door with the fork beside it.
  await page.goto(`/cars/${carId}/setups/${setupId}/edit`);
  await expect(page.locator('[data-setup-save="primary"]')).toHaveText("Save changes", {
    timeout: 30_000,
  });
  const fork = page.locator('[data-setup-save="secondary"]');
  await expect(fork).toHaveText("Save as new setup");

  await fork.click();
  const sheet = page.getByRole("dialog", { name: "Name this setup" });
  await expect(sheet, "the fork must ask what to call the copy").toBeVisible({ timeout: 15_000 });

  /*
   * The suggestion is what makes asking cost nothing: it arrives filled in and selected, so a driver
   * who doesn't care presses Save, and one who does just types over it.
   */
  const nameInput = sheet.locator("#setup-name-sheet-input");
  await expect(nameInput, "the box opens on a suggestion, not empty").toHaveValue("Mod A (edited)");

  await nameInput.fill("Sunday main");
  await sheet.getByRole("button", { name: "Save setup" }).click();

  // A setup of its own, wearing the typed name — not the source, and not the app's guess.
  await page.waitForURL((url) => url.pathname.endsWith("/edit") && !url.pathname.includes(setupId), {
    timeout: 30_000,
  });
  await expect(page.locator("h1.page-title")).toHaveText("Sunday main");

  /*
   * THE REPORTED BUG. Back to the car page as an in-app tap — a client-side navigation, which
   * `experimental.staleTimes.dynamic` (30s, next.config.mjs) will answer from the router cache. The
   * fork was the one save door that never called `router.refresh()`, so the page came back as it was
   * BEFORE the save and only a hard reload showed the new row.
   *
   * At 390px the header's back arrow is `max-md:hidden`; the phone's back control is the brand-mark
   * pill, which is why this is found by its label rather than by the header.
   */
  await page.locator('a[aria-label="Back"]:visible').first().click();
  await expect(page).toHaveURL(new RegExp(`/cars/${carId}$`));
  await expect(
    page.getByText("Sunday main").first(),
    "the copy must be on the car page without a reload"
  ).toBeVisible({ timeout: 20_000 });
});

/**
 * A run's setup offers the two doors that mean something to a run, and never an in-place write
 * (founder call, 2026-08-17). Which one is LOUD is decided by the door the driver came through —
 * see `setupSaveMode.ts` — but both are present either way.
 */
test("a run's setup offers Save as new setup and Correct this run from both doors", async ({
  page,
  request,
}) => {
  const carId = await makeCar(request, "Run doors test");
  const setupId = await makeSetup(request, carId, VALUES);

  const runRes = await request.post("/api/runs", {
    data: {
      carId,
      setupBaselineSnapshotId: setupId,
      setupData: { ...VALUES, camber_front: "-2.0" },
      // A complete run, so it is real history rather than a draft the guards may treat differently.
      carRating: 6,
    },
  });
  expect(runRes.status(), await runRes.text()).toBeLessThan(400);
  const runBody = (await runRes.json()) as { run?: { id: string }; id?: string };
  const runId = runBody.run?.id ?? runBody.id;
  expect(runId, "no run id in the create response").toBeTruthy();

  const snap = await request.get(`/api/runs/${runId}/setup-snapshot`);
  const runSetupId = ((await snap.json()) as { setupSnapshot: { id: string } }).setupSnapshot.id;

  // From the garage: the copy is loud, because Saturday must not change by accident.
  await page.goto(`/cars/${carId}/setups/${runSetupId}/edit`);
  await expect(page.locator('[data-setup-save="primary"]')).toHaveText("Save as new setup", {
    timeout: 30_000,
  });
  await expect(page.locator('[data-setup-save="secondary"]')).toHaveText("Correct this run");

  // The fork asks here too, and says what the copy leaves alone.
  await page.locator('[data-setup-save="primary"]').click();
  const sheet = page.getByRole("dialog", { name: "Name this setup" });
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  await expect(
    sheet,
    "off a run the reassurance is that the session keeps its record"
  ).toContainText("The run keeps its own record.");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // From the run itself: same pair, the other way round.
  await page.goto(`/cars/${carId}/setups/${runSetupId}/edit?run=${runId}`);
  await expect(page.locator('[data-setup-save="primary"]')).toHaveText("Correct this run", {
    timeout: 30_000,
  });
  await expect(page.locator('[data-setup-save="secondary"]')).toHaveText("Save as new setup");
});
