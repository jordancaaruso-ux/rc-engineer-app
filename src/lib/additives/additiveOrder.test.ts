import { test } from "node:test";
import assert from "node:assert/strict";
import { compareAdditiveNames } from "@/lib/additives/additiveOrder";

const names = (list: { displayName: string }[]) => list.map((t) => t.displayName);
const rows = (...displayNames: string[]) => displayNames.map((displayName) => ({ displayName }));

test("a lower-case name sorts among the others, not after every capital", () => {
  const sorted = rows("Trinity Death Row", "canowindra grip mix", "Mighty Gripper - Yellow", "BLOWFISH").sort(
    compareAdditiveNames
  );
  assert.deepEqual(names(sorted), ["BLOWFISH", "canowindra grip mix", "Mighty Gripper - Yellow", "Trinity Death Row"]);
});

test("adding one and sorting again moves nothing else", () => {
  const page = rows("apex", "Blue Label", "canowindra grip mix", "Zeta").sort(compareAdditiveNames);
  const afterAdd = [...page, { displayName: "Bravo" }].sort(compareAdditiveNames);
  assert.deepEqual(names(afterAdd), ["apex", "Blue Label", "Bravo", "canowindra grip mix", "Zeta"]);
});
