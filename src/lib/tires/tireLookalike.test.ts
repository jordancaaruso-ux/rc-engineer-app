import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tireLookalikeFinder } from "./tireLookalike";

// Real rows from the catalog (seeds/tires_offroad_10th.json, seeds/tires_touring.json), plus the
// near misses that must NOT be offered.
const catalog = [
  "Jetko J-13 Soft",
  "Jetko J-13 Super Soft",
  "Jetko J-13 Composite Super Soft",
  "Jetko J-One Composite Soft",
  "Jetko J-One Composite Super Soft",
  "Jetko J-One Medium Soft",
  "Jetko J-One Super Soft",
  "Raw Speed RC Radar Soft",
  "Raw Speed RC Low Pro Mini Slick Soft",
  "Avid RC Guardian A3 Medium Green",
  "Hudy A1 36",
  "Sweep D-36",
  "Pro-Line M4",
].map((displayName, i) => ({ id: String(i), displayName }));

const find = tireLookalikeFinder(catalog);
const name = (typed: string) => find(typed)?.displayName ?? null;

describe("tireLookalikeFinder", () => {
  it("finds the same tire written another way", () => {
    // What a driver actually typed on 2026-09-18, six days before this list reached production.
    assert.equal(name("Jetko J13 Soft"), "Jetko J-13 Soft");
    assert.equal(name("Jetko J13 Super Soft"), "Jetko J-13 Super Soft");
    assert.equal(name("Jetko J-One Soft Composite"), "Jetko J-One Composite Soft");
    assert.equal(name("Jetko J-One Super Soft Composite"), "Jetko J-One Composite Super Soft");
    assert.equal(name("jetko j 13 soft"), "Jetko J-13 Soft");
    assert.equal(name("Jetko J13 Super Soft Composite"), "Jetko J-13 Composite Super Soft");
  });

  it("ignores RC and tire words, and letters run together", () => {
    assert.equal(name("Raw Speed Radar Soft"), "Raw Speed RC Radar Soft");
    assert.equal(name("Raw Speed RC Radar Soft tyres"), "Raw Speed RC Radar Soft");
    assert.equal(name("Proline M4"), "Pro-Line M4");
  });

  it("offers nothing for a near miss", () => {
    // A different tire that happens to share most of its words.
    assert.equal(name("Jetko J-One Medium Soft Composite"), null);
    assert.equal(name("Jetko J-One Soft"), null);
    assert.equal(name("Hudy A2 36"), null);
    assert.equal(name("Sweep D-36R3PGM"), null);
    assert.equal(name("Raw Speed Mini-Pin Soft"), null);
    // One word is not a tire.
    assert.equal(name("Green"), null);
    assert.equal(name("Blue Falcon"), null);
    assert.equal(name(""), null);
    assert.equal(name(" - "), null);
  });
});
