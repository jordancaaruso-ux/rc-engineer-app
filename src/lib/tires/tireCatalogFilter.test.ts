import assert from "node:assert/strict";
import test from "node:test";
import {
  parseTireBucket,
  positionFromFits,
  tireCatalogWhere,
  tireFitsEnd,
} from "./tireCatalogFilter";

test("only a bucket the catalog holds is accepted from a query string", () => {
  assert.equal(parseTireBucket("touring"), "touring");
  assert.equal(parseTireBucket(" offroad-10th "), "offroad-10th");
  assert.equal(parseTireBucket("offroad-8th"), null);
  // A car's discipline is NOT a bucket — the two vocabularies only look alike.
  assert.equal(parseTireBucket("touring~electric"), null);
  assert.equal(parseTireBucket(""), null);
  assert.equal(parseTireBucket(null), null);
});

test("no bucket means no filter — the list every car saw before", () => {
  assert.deepEqual(tireCatalogWhere(null, "u1"), {});
});

test("a bucket keeps its own rows, the unplaced ones, and the driver's own", () => {
  assert.deepEqual(tireCatalogWhere("touring", "u1"), {
    OR: [{ discipline: "touring" }, { discipline: null }, { createdByUserId: "u1" }],
  });
});

test("a position tag can promote a tire but never rule one out", () => {
  assert.equal(tireFitsEnd("front", "front"), true);
  assert.equal(tireFitsEnd("front", "rear"), false);
  assert.equal(tireFitsEnd("rear", "rear"), true);
  assert.equal(tireFitsEnd("all", "front"), true);
  assert.equal(tireFitsEnd("all", "rear"), true);
  // Untagged: every touring row and everything a driver added.
  assert.equal(tireFitsEnd(null, "front"), true);
  assert.equal(tireFitsEnd(undefined, "rear"), true);
  assert.equal(tireFitsEnd("", "rear"), true);
});

test("fitment collapses to the union across classes", () => {
  assert.equal(positionFromFits([{ position: "front" }]), "front");
  assert.equal(positionFromFits([{ position: "rear" }, { position: "rear" }]), "rear");
  // Front on one class, rear on another: it goes on both ends somewhere.
  assert.equal(positionFromFits([{ position: "front" }, { position: "rear" }]), "all");
  // A buggy rear that is a short-course all-round.
  assert.equal(positionFromFits([{ position: "rear" }, { position: "all" }]), "all");
  assert.equal(positionFromFits([{ position: " Front " }]), "front");
});

test("a row that says nothing about fitment stays untagged", () => {
  assert.equal(positionFromFits([]), null);
  assert.equal(positionFromFits(null), null);
  assert.equal(positionFromFits(undefined), null);
  assert.equal(positionFromFits([{ position: "sideways" }, {}]), null);
});
