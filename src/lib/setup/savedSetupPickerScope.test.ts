import test from "node:test";
import assert from "node:assert/strict";
import {
  setupDocumentBelongsToCar,
  type PickerCarScope,
  type SetupDocumentScope,
} from "./savedSetupPickerScope";

function car(over: Partial<PickerCarScope> = {}): PickerCarScope {
  return {
    setupSheetModelId: "model_mi10",
    setupSheetTemplate: "mi10",
    siblingCarIds: new Set(["car_mi10"]),
    ...over,
  };
}

function doc(over: Partial<SetupDocumentScope> = {}): SetupDocumentScope {
  return { carId: null, setupSheetModelId: null, setupSheetTemplate: null, ...over };
}

test("a sheet tagged with another chassis type never shows on this car", () => {
  assert.equal(
    setupDocumentBelongsToCar(doc({ setupSheetModelId: "model_mugen_mtc3" }), car()),
    false
  );
});

test("a sheet of the same chassis type shows even with no car attached", () => {
  assert.equal(setupDocumentBelongsToCar(doc({ setupSheetModelId: "model_mi10" }), car()), true);
});

test("legacy template documents match case-insensitively", () => {
  assert.equal(setupDocumentBelongsToCar(doc({ setupSheetTemplate: "MI10" }), car()), true);
  assert.equal(
    setupDocumentBelongsToCar(doc({ setupSheetTemplate: "mugen_mtc3" }), car()),
    false
  );
});

test("template wins when the car has no chassis type id (legacy car row)", () => {
  const legacyCar = car({ setupSheetModelId: null });
  assert.equal(
    setupDocumentBelongsToCar(
      doc({ setupSheetModelId: "model_mi10", setupSheetTemplate: "mi10" }),
      legacyCar
    ),
    true
  );
});

test("a typed document is hidden from a car with no chassis type at all", () => {
  const untyped = car({ setupSheetModelId: null, setupSheetTemplate: null });
  assert.equal(setupDocumentBelongsToCar(doc({ setupSheetModelId: "model_mi10" }), untyped), false);
});

test("an untyped document follows its car and its siblings", () => {
  const withSibling = car({ siblingCarIds: new Set(["car_mi10", "car_mi10_b"]) });
  assert.equal(setupDocumentBelongsToCar(doc({ carId: "car_mi10_b" }), withSibling), true);
  assert.equal(setupDocumentBelongsToCar(doc({ carId: "car_mugen" }), withSibling), false);
});

test("a document with no identity at all only shows on a car with no chassis type", () => {
  assert.equal(setupDocumentBelongsToCar(doc(), car()), false);
  assert.equal(
    setupDocumentBelongsToCar(doc(), car({ setupSheetModelId: null, setupSheetTemplate: null })),
    true
  );
});

test("no car selected keeps everything", () => {
  assert.equal(setupDocumentBelongsToCar(doc({ setupSheetModelId: "model_mugen_mtc3" }), null), true);
});
