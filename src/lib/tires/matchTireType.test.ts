import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bestTireTypeMatch,
  matchTireTypes,
  normalizeTireText,
  scoreTireTypeMatch,
} from "./matchTireType";

const catalog = [
  { id: "1", displayName: "Sweep 32", modelCode: "SWEEP-32" },
  { id: "2", displayName: "Vault 32", modelCode: "VAULT-32" },
  { id: "3", displayName: "Pro-Line M4 Medium", modelCode: "PL-M4-M" },
];

describe("matchTireType", () => {
  it("normalizes tire text", () => {
    assert.equal(normalizeTireText("  Sweep 32 #2  "), "sweep 32");
    assert.equal(normalizeTireText("Sweep32"), "sweep32");
  });

  it("scores exact and fuzzy matches", () => {
    assert.equal(scoreTireTypeMatch("sweep 32", catalog[0]!), 100);
    assert.ok(scoreTireTypeMatch("sweep32", catalog[0]!) >= 70);
    assert.ok(scoreTireTypeMatch("vault", catalog[1]!) >= 70);
  });

  it("returns best match above threshold", () => {
    const hit = bestTireTypeMatch("Sweep 32", catalog);
    assert.equal(hit?.id, "1");
    assert.equal(bestTireTypeMatch("unknown xyz", catalog), null);
  });

  it("ranks multiple matches", () => {
    const matches = matchTireTypes("32", catalog, 5);
    assert.ok(matches.length >= 2);
    assert.ok(matches[0]!.score >= matches[1]!.score);
  });
});
