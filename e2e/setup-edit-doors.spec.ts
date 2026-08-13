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

  // And the API agrees: a PATCH of the values is accepted, not 404'd on `isLibrary`.
  const patch = await request.patch(`/api/setup-snapshots/${setupId}`, {
    data: { data: { camber_front: "-1.7" } },
  });
  expect(patch.status(), await patch.text()).toBe(200);
});

test("a run's setup refuses an in-place write, and a correction keeps what the run changed", async ({
  request,
}) => {
  const { carId, setupId, values } = await makeUploadedSetup(request);

  // A chassis key off the sheet itself, so this doesn't hard-code one chassis's field names.
  const key = Object.keys(values).find(
    (k) => !["tires", "tires_setup", "additive", "additive_time"].includes(k)
  );
  expect(key, "the sheet read nothing, so there is nothing to change").toBeTruthy();

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
