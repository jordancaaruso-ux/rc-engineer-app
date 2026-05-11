import assert from "node:assert/strict";
import { buildQuickCustomFieldDefinition } from "@/lib/setupCalibrations/quickCalibrationField";

void (async function main() {
  const n = buildQuickCustomFieldDefinition({
    id: "t1",
    key: "ride_h_front",
    displayLabel: "Ride H F",
    kind: "number",
    optionLabels: [],
    sectionId: "tuning",
    sectionTitle: "Tuning",
    sortOrder: 0,
  });
  assert.equal(n.valueType, "number");

  const g = buildQuickCustomFieldDefinition({
    id: "t2",
    key: "screws",
    displayLabel: "Screws",
    kind: "many_of_many",
    optionLabels: ["A", "B"],
    sectionId: "flex",
    sectionTitle: "Flex",
    sortOrder: 1,
  });
  assert.equal(g.groupedOptions?.length, 2);
  assert.ok(g.groupedOptions?.[0]?.optionValue);

  console.log("quickCalibrationField tests ok");
})();
