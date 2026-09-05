import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Every saved setup has a way off the list, and the row offers the door the API will honour.
 *
 * ============================== THE BUG THIS PINS ==============================
 *
 * Founder report, 2026-09-03: "currently no way to delete / remove setups from saved setups in a
 * car". There WAS a Delete — it drew only where `runs + derivedSnapshots === 0`, and logging a run
 * from a saved setup writes a snapshot pointing back at it (`baseSetupSnapshotId`). So the setups a
 * driver actually raced were exactly the ones that could never be removed, while the API would have
 * deleted most of them happily: only a run's own record is truly undeletable.
 *
 * A unit test on `decideSetupRemoval` cannot catch that, because the whole failure was the card and
 * the route deciding separately. This spec drives the real page against the real API.
 *
 * Fixtures are built through the API rather than the upload pipeline — no PDF, no chassis — so the
 * suite runs in seconds and pins the rule, not one manufacturer's sheet.
 */

const SETUP_VALUES = { camber_front: "-1.5", ride_height_front: "5.0" };

async function makeCar(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post("/api/cars", { data: { name } });
  expect(res.status(), await res.text()).toBeLessThan(400);
  return ((await res.json()) as { car: { id: string } }).car.id;
}

async function makeSavedSetup(
  request: APIRequestContext,
  carId: string,
  name: string
): Promise<string> {
  const res = await request.post("/api/setup-snapshots", {
    data: { carId, name, data: SETUP_VALUES },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { setup: { id: string } }).setup.id;
}

/** A complete run started FROM `setupId` — which is what hands the setup a derived snapshot. */
async function logRunFrom(
  request: APIRequestContext,
  input: { carId: string; setupId: string }
): Promise<string> {
  const res = await request.post("/api/runs", {
    data: {
      carId: input.carId,
      setupBaselineSnapshotId: input.setupId,
      setupData: { ...SETUP_VALUES, camber_front: "-1.7" },
      carRating: 6,
    },
  });
  const body = (await res.json()) as { run?: { id: string }; id?: string };
  expect(res.status(), JSON.stringify(body).slice(0, 300)).toBeLessThan(400);
  const runId = body.run?.id ?? body.id;
  expect(runId, "no run id in the create response").toBeTruthy();
  return runId!;
}

/** The snapshot the run recorded for itself — a different row from the one it started from. */
async function runOwnSetupId(request: APIRequestContext, runId: string): Promise<string> {
  const res = await request.get(`/api/runs/${runId}/setup-snapshot`);
  return ((await res.json()) as { setupSnapshot: { id: string } }).setupSnapshot.id;
}

test("a saved setup you have raced from can still be deleted", async ({ page, request }) => {
  const carId = await makeCar(request, `Delete doors ${Date.now()}`);
  const setupId = await makeSavedSetup(request, carId, "Saturday baseline");
  const runId = await logRunFrom(request, { carId, setupId });

  await page.goto(`/cars/${carId}`);
  /*
   * THE REGRESSION. This button was absent the moment the setup was raced, and no other door on the
   * card took its place — the row was a dead end. Only Saved setups has a Delete, so the button
   * names the row without a fragile card selector.
   */
  const del = page.getByRole("button", { name: "Delete", exact: true });
  await expect(del, "a setup runs merely started from must still be deletable").toBeVisible({
    timeout: 30_000,
  });

  // The count says what it is: a run STARTED here, it is not this setup's own run.
  const savedRow = page.locator("li", { has: del });
  await expect(savedRow).toContainText("1 run from it");

  page.once("dialog", (d) => {
    // The question answers the fear it raises, in the same breath.
    expect(d.message()).toContain("keeps its own numbers");
    void d.accept();
  });
  await del.click();

  await expect(
    page.locator(`a[href="/cars/${carId}/setups/${setupId}"]`),
    "the deleted setup must leave the page"
  ).toHaveCount(0, { timeout: 15_000 });

  /*
   * And the run it fathered is untouched, values and all — the point of allowing this delete at
   * all. `SetupSnapshot.data` is the full resolved setup, so nothing was leaning on the parent.
   */
  const recordId = await runOwnSetupId(request, runId);
  const record = await request.get(`/api/setup-snapshots/${recordId}`);
  expect(record.status(), "deleting a baseline must not touch the runs from it").toBe(200);
  const kept = (await record.json()) as { setup: { data: Record<string, unknown> } };
  // Stored as a number: `normalizeSetupSnapshotForStorage` coerces what the wizard sends as text.
  expect(Number(kept.setup.data.camber_front), "the run keeps the numbers it raced").toBe(-1.7);
});

test("a run's own record is removed from the list, never deleted", async ({ page, request }) => {
  const carId = await makeCar(request, `Remove doors ${Date.now()}`);
  const baselineId = await makeSavedSetup(request, carId, "Friday baseline");
  const runId = await logRunFrom(request, { carId, setupId: baselineId });
  const recordId = await runOwnSetupId(request, runId);

  // Keep the run's setup — the bookmark on All setups marks this very snapshot, never a copy.
  const kept = await request.post(`/api/setup-snapshots/${recordId}/save`, {
    data: { saved: true, name: "Q2 as raced" },
  });
  expect(kept.status(), await kept.text()).toBe(200);

  await page.goto(`/cars/${carId}`);
  const remove = page.getByRole("button", { name: "Remove", exact: true });
  await expect(remove, "a run's saved setup must still have a way off the list").toBeVisible({
    timeout: 30_000,
  });

  const savedRow = page.locator("li", { has: remove });
  await expect(
    savedRow.getByRole("button", { name: "Delete", exact: true }),
    "a row must never offer a delete the API refuses"
  ).toHaveCount(0);
  // It IS the run's record, so the count reads as the record — not as runs that started from it.
  await expect(savedRow).toContainText("1 run");
  await expect(savedRow).not.toContainText("from it");

  // The API is the one that has to hold, so ask it directly.
  const refused = await request.delete(`/api/setup-snapshots/${recordId}`);
  expect(refused.status()).toBe(409);
  expect(await refused.text()).toContain("Remove it from saved");

  /*
   * Saving MARKS the snapshot rather than copying it, so this one setup is on screen more than once
   * — Saved setups, the run's row in All setups, and "On the car now" all link to it. Only a Saved
   * setups row carries Remove, so that button disappearing IS the row leaving the list; counting
   * links would be counting the other cards.
   */
  await remove.click();
  await expect(
    remove,
    "removing takes the row off Saved setups and leaves the run's own row alone"
  ).toHaveCount(0, { timeout: 15_000 });
  await expect(
    page.locator(`a[href="/cars/${carId}/setups/${recordId}"]`).first(),
    "the run's own row must survive it"
  ).toBeVisible();

  // Removed from the list, not from the world: the run still has its record.
  const stillOwned = await request.get(`/api/setup-snapshots/${recordId}`);
  expect(stillOwned.status(), "un-saving must never destroy a run's setup").toBe(200);
});
