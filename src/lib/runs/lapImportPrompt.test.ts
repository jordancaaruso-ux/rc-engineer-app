import assert from "node:assert/strict";
import test from "node:test";

import { runHasLapTimes, runNeedsLapImport } from "./lapImportPrompt";

test("laps typed/pasted into lapTimes count as present", () => {
  assert.equal(runHasLapTimes({ lapTimes: [19.84, 20.11] }), true);
  assert.equal(runNeedsLapImport({ lapTimes: [19.84, 20.11] }), false);
});

test("an imported lap set alone counts as present", () => {
  // The LiveRC path leaves lapTimes empty and attaches importedLapSets — the
  // reason this can't be a single-field check.
  assert.equal(runHasLapTimes({ lapTimes: [], importedLapSets: [{ id: "s1" }] }), true);
  assert.equal(runNeedsLapImport({ lapTimes: [], importedLapSets: [{ id: "s1" }] }), false);
});

test("neither source → the run needs an import", () => {
  assert.equal(runHasLapTimes({ lapTimes: [], importedLapSets: [] }), false);
  assert.equal(runNeedsLapImport({ lapTimes: [], importedLapSets: [] }), true);
});

test("missing/null fields are treated as no laps, not as a crash", () => {
  assert.equal(runHasLapTimes({}), false);
  assert.equal(runNeedsLapImport({ lapTimes: null, importedLapSets: null }), true);
});

test("dismissing silences the warning but does not invent laps", () => {
  const run = { lapTimes: [], importedLapSets: [], lapImportPromptDismissedAt: new Date() };
  assert.equal(runNeedsLapImport(run), false);
  assert.equal(runHasLapTimes(run), false);
});

test("drafts are excluded — they are lapless by design, and already badged", () => {
  assert.equal(
    runNeedsLapImport({ lapTimes: [], importedLapSets: [], loggingComplete: false }),
    false
  );
  // A completed run with the same emptiness IS the reported bug.
  assert.equal(
    runNeedsLapImport({ lapTimes: [], importedLapSets: [], loggingComplete: true }),
    true
  );
  // Field absent (callers that don't select it) must not silently suppress.
  assert.equal(runNeedsLapImport({ lapTimes: [], importedLapSets: [] }), true);
});

test("a dismissedAt arriving as a JSON string still silences the warning", () => {
  // Server components hand rows to the client table unmapped; dates may cross
  // as ISO strings depending on the serialisation path.
  assert.equal(
    runNeedsLapImport({ lapTimes: [], lapImportPromptDismissedAt: "2026-08-08T10:00:00.000Z" }),
    false
  );
});
