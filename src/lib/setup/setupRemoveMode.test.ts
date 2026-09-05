import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  decideSetupRemoval,
  setupDeleteConfirmMessage,
  setupDeleteRefusalMessage,
  setupUsageLabel,
  type SetupRemoveInput,
} from "./setupRemoveMode";

const NOTHING: SetupRemoveInput = {
  isLibrary: true,
  runCount: 0,
  derivedCount: 0,
  sourceDocumentCount: 0,
};

test("a saved setup nothing points at can be deleted", () => {
  assert.deepEqual(decideSetupRemoval(NOTHING), { kind: "delete", derivedCount: 0 });
});

/*
 * THE REGRESSION THIS FILE EXISTS FOR.
 *
 * Logging a run from a saved setup writes a new snapshot pointing back at it, so the setup picks up
 * a derived row while its own run count stays at zero. The card added the two together and hid
 * Delete, which meant every setup the driver actually raced was undeletable — while the API would
 * have allowed it all along.
 */
test("runs that STARTED from a setup never block deleting it", () => {
  assert.deepEqual(decideSetupRemoval({ ...NOTHING, derivedCount: 12 }), {
    kind: "delete",
    derivedCount: 12,
  });
});

test("a setup a run points at is that run's record — remove from saved, never delete", () => {
  assert.deepEqual(decideSetupRemoval({ ...NOTHING, runCount: 1 }), {
    kind: "unsave",
    because: "run",
    runCount: 1,
  });
  // Still the run's record even when other setups were started from it.
  assert.deepEqual(decideSetupRemoval({ ...NOTHING, runCount: 3, derivedCount: 5 }), {
    kind: "unsave",
    because: "run",
    runCount: 3,
  });
});

/*
 * An uploaded sheet's setup is the only row `SetupDocument.createdSetupId` points at, and it is a
 * link in the chain `resolveUploadedPdfSourceForRun` walks to find the driver's own paper. Deleting
 * it mid-chain exports the runs below it on the wrong sheet.
 */
test("an uploaded sheet's setup is protected only once something came from it", () => {
  assert.deepEqual(decideSetupRemoval({ ...NOTHING, sourceDocumentCount: 1 }), {
    kind: "delete",
    derivedCount: 0,
  });
  assert.deepEqual(decideSetupRemoval({ ...NOTHING, sourceDocumentCount: 1, derivedCount: 1 }), {
    kind: "unsave",
    because: "sheet",
    runCount: 0,
  });
});

test("a setup that was never saved has nothing to be removed from", () => {
  assert.deepEqual(decideSetupRemoval({ ...NOTHING, isLibrary: false }), { kind: "none" });
  assert.deepEqual(
    decideSetupRemoval({ isLibrary: false, runCount: 4, derivedCount: 2, sourceDocumentCount: 1 }),
    { kind: "none" }
  );
});

test("the confirm stays quiet when there is nothing to warn about", () => {
  assert.equal(setupDeleteConfirmMessage("Bayside qualifier", 0), "Delete “Bayside qualifier”?");
  assert.equal(
    setupDeleteConfirmMessage("Bayside qualifier", 1),
    "Delete “Bayside qualifier”? 1 run started from it and keeps its own numbers."
  );
  assert.equal(
    setupDeleteConfirmMessage("Bayside qualifier", 4),
    "Delete “Bayside qualifier”? 4 runs started from it and keep their own numbers."
  );
});

test("a refusal says which door to use instead", () => {
  assert.match(
    setupDeleteRefusalMessage({ kind: "unsave", because: "run", runCount: 1 }),
    /1 logged run recorded.*Remove it from saved/
  );
  assert.match(
    setupDeleteRefusalMessage({ kind: "unsave", because: "run", runCount: 2 }),
    /2 logged runs recorded/
  );
  assert.match(
    setupDeleteRefusalMessage({ kind: "unsave", because: "sheet", runCount: 0 }),
    /sheet you uploaded.*Remove it from saved/
  );
});

test("the row counts runs it IS apart from runs that came from it", () => {
  assert.equal(setupUsageLabel({ runCount: 0, derivedCount: 0 }), null);
  assert.equal(setupUsageLabel({ runCount: 1, derivedCount: 0 }), "1 run");
  assert.equal(setupUsageLabel({ runCount: 0, derivedCount: 1 }), "1 run from it");
  assert.equal(setupUsageLabel({ runCount: 0, derivedCount: 6 }), "6 runs from it");
  // A run's own record that others started from reads as the record — that is what it is.
  assert.equal(setupUsageLabel({ runCount: 2, derivedCount: 6 }), "2 runs");
});
