import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * Every setup of yours opens, and every setup can be edited.
 *
 * Two things this pins, both reported from the app on 2026-08-13:
 *
 *  - **"Open the sheet" must never land on the import-review workbench.** It pointed at
 *    `/setup-documents/[id]`, whose own header reads "Review setup — check the imported values look
 *    right": the car picker, the calibration list, the extracted-value rows. Tapping it on a setup
 *    that had imported perfectly well showed the driver a form asking them to check an import that
 *    was already finished.
 *  - **An uploaded setup used to have no editor at all.** Editability was gated on `isLibrary`,
 *    which a sheet-created snapshot never sets, so the Edit button was hidden, the edit route 404'd
 *    and the API 404'd — purely because nobody had bookmarked it. The rule is now the one that
 *    describes the real risk: values are writable when no run points at them.
 *
 * The fixture is the same fillable Xray sheet `setup-sheet-upload-door.spec.ts` pins, so this suite
 * builds its own uploaded setup on a throwaway account rather than depending on anyone's data.
 */

const EDITABLE = "scripts/setup-extract-eval/gold/xray-x4-2026/files/x4_2026_set_up_editable_v02.pdf";

async function makeUploadedSetup(request: APIRequestContext): Promise<{
  carId: string;
  setupId: string;
  /** What the sheet read, so callers can change a real field of this chassis rather than guess. */
  values: Record<string, unknown>;
}> {
  const modelsRes = await request.get("/api/setup-sheet-models");
  const models = ((await modelsRes.json()) as { models: Array<{ id: string; name: string }> })
    .models;
  const model = models.find((m) => /x4/i.test(m.name));
  expect(model, `no X4 chassis in the catalog: ${models.map((m) => m.name).join(", ")}`).toBeTruthy();

  const carRes = await request.post("/api/cars", {
    data: { name: "X4 door test", setupSheetModelId: model!.id },
  });
  expect(carRes.status(), await carRes.text()).toBeLessThan(400);
  const carId = ((await carRes.json()) as { car: { id: string } }).car.id;

  const res = await request.post("/api/setup-documents/quick-create", {
    multipart: {
      carId,
      setupSheetModelId: model!.id,
      file: {
        name: "x4_2026_set_up_editable_v02.pdf",
        mimeType: "application/pdf",
        buffer: readFileSync(EDITABLE),
      },
    },
    timeout: 120_000,
  });
  const body = (await res.json()) as {
    setupId?: string | null;
    documentId: string;
    parseStatus: string;
  };
  expect(res.status(), `upload refused: ${JSON.stringify(body).slice(0, 300)}`).toBeLessThan(400);

  const doc = await request.get(`/api/setup-documents/${body.documentId}`);
  const docBody = (await doc.json()) as {
    document?: { parsedDataJson?: Record<string, unknown> | null };
    parsedDataJson?: Record<string, unknown> | null;
  };
  const values = docBody.document?.parsedDataJson ?? docBody.parsedDataJson ?? {};

  if (body.setupId) return { carId, setupId: body.setupId, values };

  /*
   * The sheet parsed but the calibration wasn't an exact fingerprint match, so the upload stopped
   * at the review screen. That is a normal outcome and it produces exactly the row this suite is
   * about — a setup a sheet created, `isLibrary` false — so take the review screen's own door.
   */
  const made = await request.post(`/api/setup-documents/${body.documentId}/create-setup`, {
    data: { carId, setupData: values },
  });
  expect(made.status(), await made.text()).toBe(201);
  const setupId = ((await made.json()) as { setup: { id: string } }).setup.id;

  return { carId, setupId, values };
}

async function openSetupFromAllSetups(page: Page, carId: string, setupId: string) {
  await page.goto(`/cars/${carId}`);
  const row = page.locator(`a[href="/cars/${carId}/setups/${setupId}"]`).first();
  await expect(row, "the uploaded sheet's row must open the setup, not the review screen").toBeVisible(
    { timeout: 30_000 }
  );
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/cars/${carId}/setups/${setupId}$`));
}

test("an uploaded setup opens its own page, and the sheet door is the PDF", async ({
  page,
  request,
}) => {
  const { carId, setupId } = await makeUploadedSetup(request);
  await openSetupFromAllSetups(page, carId, setupId);

  // The original file, not the workbench.
  const pdf = page.locator(`a[href="/api/setup-documents/"i], a:has-text("Original PDF")`).first();
  await expect(pdf, "the driver's own file must be one tap away").toBeVisible();

  /*
   * The regression itself. A document that parsed has nothing left to review, so nothing on this
   * page may lead back to "Review setup" — the screen that made this look like the old form.
   */
  await expect(
    page.locator('a[href^="/setup-documents/"]'),
    "a finished import must not offer the review workbench"
  ).toHaveCount(0);
});

test("an uploaded setup can be edited, and the edit saves", async ({ page, request }) => {
  const { carId, setupId } = await makeUploadedSetup(request);
  await openSetupFromAllSetups(page, carId, setupId);

  // No run points at a fresh upload, so the door is a plain Edit rather than a run correction.
  const edit = page.getByRole("link", { name: "Edit", exact: true });
  await expect(edit, "an uploaded setup is not history — it must be editable").toBeVisible();
  await edit.click();
  await expect(page).toHaveURL(new RegExp(`/cars/${carId}/setups/${setupId}/edit$`));

  // The editor rendered rather than 404'ing, and it offers the copy door.
  await expect(page.getByRole("button", { name: /save as new setup/i })).toBeVisible({
    timeout: 30_000,
  });

  /*
   * Opening a setup is not work. The bar used to arm itself the moment the editor handed its values
   * back — which React does on its own, with nobody touching a box — so every setup opened claiming
   * unsaved changes. Dirty is a comparison against the values as opened now, so an untouched setup
   * carries no amber, no count, and no filled button to press by reflex.
   */
  const bar = page.locator(".setup-save-panel");
  await expect(bar, "a setup nobody has touched has nothing to save").not.toHaveAttribute(
    "data-dirty",
    /.*/
  );
  // The count specifically: "changes" also appears on the in-place button and in the mode's note.
  await expect(bar).not.toContainText(/\d+\s+changes?\b/);
  await expect(
    page.locator('[data-setup-save="primary"]'),
    "writing zero changes over a setup does nothing, so the door is not the loud one"
  ).not.toHaveAttribute("data-loud", /.*/);

  // And the API agrees: a PATCH of the values is accepted, not 404'd on `isLibrary`.
  const patch = await request.patch(`/api/setup-snapshots/${setupId}`, {
    data: { data: { camber_front: "-1.7" } },
  });
  expect(patch.status(), await patch.text()).toBe(200);
});

/** A complete run on `setupId`, changing exactly one field. Returns the run and its own snapshot. */
async function logRunAgainst(
  request: APIRequestContext,
  input: { carId: string; setupId: string; values: Record<string, unknown>; key: string; to: string }
): Promise<{ runId: string; runSetupId: string }> {
  const runRes = await request.post("/api/runs", {
    data: {
      carId: input.carId,
      setupBaselineSnapshotId: input.setupId,
      setupData: { ...input.values, [input.key]: input.to },
      // A complete run, so it is real history rather than a draft the guards may treat differently.
      carRating: 6,
    },
  });
  const runBody = (await runRes.json()) as { run?: { id: string }; id?: string };
  expect(runRes.status(), JSON.stringify(runBody).slice(0, 300)).toBeLessThan(400);
  const runId = runBody.run?.id ?? runBody.id;
  expect(runId, "no run id in the create response").toBeTruthy();

  const res = await request.get(`/api/runs/${runId}/setup-snapshot`);
  const body = (await res.json()) as { setupSnapshot: { id: string } };
  return { runId: runId!, runSetupId: body.setupSnapshot.id };
}

/** The first non-tire key the sheet actually read — so this suite pins no one chassis's names. */
function editableKey(values: Record<string, unknown>): string {
  const key = Object.keys(values).find(
    (k) => !["tires", "tires_setup", "additive", "additive_time"].includes(k)
  );
  expect(key, "the sheet read nothing, so there is nothing to change").toBeTruthy();
  return key!;
}

/**
 * The door decides what a save means (founder call, 2026-08-16).
 *
 * Same setup, same driver, two entrances. From the garage it is a starting point and saving must
 * leave the run alone; from the run it is that day's record and saving corrects it. Before this,
 * one run count decided for both and the garage's loud button said "Correct this run".
 */
test("a run's setup edits as a copy from the garage and as a correction from the run", async ({
  page,
  request,
}) => {
  const { carId, setupId, values } = await makeUploadedSetup(request);
  const key = editableKey(values);
  const { runId, runSetupId } = await logRunAgainst(request, {
    carId,
    setupId,
    values,
    key,
    to: "9.5",
  });

  // ── The garage door: no `?run=`, so nothing here may write to the run ──────────────────────
  await page.goto(`/cars/${carId}/setups/${runSetupId}/edit`);
  const fork = page.locator('[data-setup-save="primary"]');
  await expect(fork, "editing from the garage saves as its own setup").toHaveText(
    "Save as new setup",
    { timeout: 30_000 }
  );
  // The correction is still reachable — one run points here, so "this run" names something — but
  // it is the quiet second door, never the one a driver presses by reflex.
  await expect(page.locator('[data-setup-save="secondary"]')).toHaveText("Correct this run");

  /*
   * Opening a setup is not work. The bar used to arm itself the moment the editor handed its values
   * back — which React does on its own, with nobody touching a box — and every setup therefore
   * opened claiming unsaved changes. Dirty is a comparison now, so an untouched setup carries no
   * amber and no count.
   */
  await expect(
    page.locator(".setup-save-panel"),
    "a setup nobody has touched has nothing to save"
  ).not.toHaveAttribute("data-dirty", /.*/);
  // The count, specifically: "changes" appears in the mode's own note and on the in-place button.
  await expect(page.locator(".setup-save-panel")).not.toContainText(/\d+\s+changes?\b/);

  /*
   * The fork ASKS what to call the copy (founder call, 2026-08-17). It used to name itself
   * "<source> (edited)" and offer Rename afterwards, which stacked suffixes on a fork of a fork and
   * gave two copies of one setup the same name. The suggestion still arrives selected, so a driver
   * who doesn't care saves in one tap; this one cares.
   */
  await fork.click();
  const nameSheet = page.getByRole("dialog", { name: "Name this setup" });
  await expect(nameSheet, "the fork must ask what to call the copy").toBeVisible({
    timeout: 30_000,
  });
  const nameInput = nameSheet.locator("#setup-name-sheet-input");
  await expect(nameInput, "the box opens on a suggestion, not empty").toHaveValue(/\(edited\)$/);
  await nameInput.fill("Sunday main");
  await nameSheet.getByRole("button", { name: "Save setup" }).click();
  /*
   * The predicate has to exclude the setup we started on. `toHaveURL(/setups\/[^/]+\/edit$/)`
   * passes on the FIRST poll against the URL already in the bar, so the assertion after it read the
   * old id while the POST was still in flight — a green test that proved nothing.
   */
  await page.waitForURL(
    (url) => url.pathname.endsWith("/edit") && !url.pathname.includes(runSetupId),
    { timeout: 30_000 }
  );
  const forkedId = page.url().match(/setups\/([^/]+)\/edit/)?.[1];
  expect(forkedId, "the fork must land on a setup of its own").toBeTruthy();

  // The whole point: Saturday is untouched.
  const stillPointing = await request.get(`/api/runs/${runId}/setup-snapshot`);
  expect(
    ((await stillPointing.json()) as { setupSnapshot: { id: string } }).setupSnapshot.id,
    "saving from the garage must not move the run onto the copy"
  ).toBe(runSetupId);

  /*
   * And the copy says where it came from, rather than appearing from nowhere.
   *
   * Scoped to the body caption on purpose: the page header computes the same words into
   * `.page-subtitle`, which `globals.css` sets to `display: none`. A bare text match resolves to
   * that hidden copy and can never be satisfied — which is how the invisible provenance line was
   * found in the first place.
   */
  await page.goto(`/cars/${carId}/setups/${forkedId}`);
  await expect(
    page.locator("p.ui-caption", { hasText: /Edited from/i }),
    "a forked setup must name its source somewhere the driver can actually see"
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator("h1.page-title"),
    "the copy is called what the driver typed, not what the app guessed"
  ).toHaveText("Sunday main");

  // ── The run's door: `?run=` makes the correction the loud one ──────────────────────────────
  await page.goto(`/cars/${carId}/setups/${runSetupId}/edit?run=${runId}`);
  await expect(page.locator('[data-setup-save="primary"]')).toHaveText("Correct this run", {
    timeout: 30_000,
  });
  await expect(page.locator('[data-setup-save="secondary"]')).toHaveText("Save as new setup");
});

/** A `?run=` naming someone else's run, or a run that isn't on these numbers, buys nothing. */
test("a ?run= that doesn't point at this setup falls back to the garage reading", async ({
  page,
  request,
}) => {
  const { carId, setupId, values } = await makeUploadedSetup(request);
  const key = editableKey(values);
  const a = await logRunAgainst(request, { carId, setupId, values, key, to: "9.5" });
  const b = await logRunAgainst(request, { carId, setupId, values, key, to: "4.5" });
  expect(b.runSetupId, "the two runs must have separate records").not.toBe(a.runSetupId);

  // Run B's id against run A's snapshot: a real run, a real setup, but not each other's.
  await page.goto(`/cars/${carId}/setups/${a.runSetupId}/edit?run=${b.runId}`);
  await expect(
    page.locator('[data-setup-save="primary"]'),
    "the loud button must never be a correction the URL only claimed"
  ).toHaveText("Save as new setup", { timeout: 30_000 });
});

test("a run's setup refuses an in-place write, and a correction keeps what the run changed", async ({
  request,
}) => {
  const { carId, setupId, values } = await makeUploadedSetup(request);
  const key = editableKey(values);

  // A run logged against the uploaded setup, changing exactly one thing.
  const runRes = await request.post("/api/runs", {
    data: {
      carId,
      setupBaselineSnapshotId: setupId,
      setupData: { ...values, [key!]: "9.5" },
      // A complete run, so it is real history rather than a draft the guards may treat differently.
      carRating: 6,
    },
  });
  const runBody = (await runRes.json()) as { run?: { id: string }; id?: string };
  expect(runRes.status(), JSON.stringify(runBody).slice(0, 300)).toBeLessThan(400);
  const runId = runBody.run?.id ?? runBody.id;
  expect(runId, "no run id in the create response").toBeTruthy();

  const runSnapshot = await request.get(`/api/runs/${runId}/setup-snapshot`);
  const before = (await runSnapshot.json()) as {
    setupSnapshot: { id: string; baseSetupSnapshotId: string | null };
  };
  const runSetupId = before.setupSnapshot.id;
  expect(before.setupSnapshot.baseSetupSnapshotId, "the run was logged against the upload").toBe(
    setupId
  );

  // The run's own record cannot be written over — that would change what it says it raced.
  const patch = await request.patch(`/api/setup-snapshots/${runSetupId}`, {
    data: { data: { ...values, [key!]: "3.3" } },
  });
  expect(patch.status(), "a run's record must refuse an in-place value write").toBe(409);
  expect(String(((await patch.json()) as { error: string }).error)).toMatch(
    /correct the run|new setup/i
  );

  /*
   * The correction door. The regression it guards: basing the corrected snapshot on the one being
   * replaced rewrote the run's audit to "what I just retyped", so the car page's row for this run
   * would forget the change it was actually logged with.
   */
  const corrected = await request.patch(`/api/runs/${runId}/setup-snapshot`, {
    data: { setupData: { ...values, [key!]: "3.3" } },
  });
  expect(corrected.status(), await corrected.text()).toBe(200);

  const history = await request.get(`/api/runs/${runId}/setup-snapshot`);
  const after = (await history.json()) as {
    setupSnapshot: { id: string; baseSetupSnapshotId: string | null };
  };
  expect(
    after.setupSnapshot.id,
    "a correction writes a new snapshot, never edits the old one"
  ).not.toBe(runSetupId);
  expect(
    after.setupSnapshot.baseSetupSnapshotId,
    "the corrected run still measures against the setup it was logged from, not against its own pre-correction values"
  ).toBe(setupId);
});
