import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { trackLookalikeFinder, type TrackLookalikeRow } from "./trackLookalike";

// Real catalog rows (scratch copy of production, 2026-09-26), including the near misses that must
// not be offered.
const catalog: TrackLookalikeRow[] = [
  { name: "Knox Offroad RC Club", location: "Knoxfield VIC", region: "Victoria", countryCode: "au", liveRcUrl: "https://knox.liverc.com", catalogEventCount: 154 },
  { name: "Mini-Z Knox", location: "Knoxville, Tennessee", region: "Tennessee", countryCode: "us", liveRcUrl: "https://minizknox.liverc.com", catalogEventCount: 97 },
  { name: "RC Madness", location: "Enfield, Connecticut", region: "Connecticut", countryCode: "us", liveRcUrl: "https://rcmadness.liverc.com", catalogEventCount: 1422 },
  { name: "RC Madness 2", location: "Enfield, Connecticut", region: "Connecticut", countryCode: "us", liveRcUrl: "https://rcmadness2.liverc.com", catalogEventCount: 1518 },
  { name: "Eastern Model Car Club", location: "Melbourne, Victoria", region: "Victoria", countryCode: "au", liveRcUrl: "https://emcc.liverc.com", catalogEventCount: 38 },
  { name: "South Eastern Radio Controlled Car Club", location: "Melbourne", region: null, countryCode: null, liveRcUrl: "https://serccc.liverc.com", catalogEventCount: 85 },
  { name: "West Coast Model RC", location: "Perth", region: "Western Australia", countryCode: "au", liveRcUrl: "https://westcoast.liverc.com", catalogEventCount: 700 },
  { name: "Indoor Raceway", location: "Stevenage, Hertfordshire", region: "England", countryCode: "gb", liveRcUrl: "https://indoorraceway.liverc.com", catalogEventCount: 269 },
].map((r, i) => ({ ...r, id: String(i) }));

const find = trackLookalikeFinder(catalog);
const names = (typed: string, options?: Parameters<typeof find>[1]) => find(typed, options).map((m) => m.row.name);
const AU = { homeCountries: ["au"] };
const US = { homeCountries: ["us"] };

describe("trackLookalikeFinder", () => {
  it("finds the club behind other spellings of its name", () => {
    assert.deepEqual(names("Knox Offroad", AU), ["Knox Offroad RC Club"]);
    assert.deepEqual(names("Knox RC", AU), ["Knox Offroad RC Club"]);
    assert.deepEqual(names("offroad knox", AU), ["Knox Offroad RC Club"]);
    assert.deepEqual(names("KNOX OFF-ROAD RC CLUB", AU), ["Knox Offroad RC Club"]);
    assert.deepEqual(names("West Coast", AU), ["West Coast Model RC"]);
  });

  it("finds a club from its initials or its LiveRC name", () => {
    assert.equal(names("SERCCC", AU)[0], "South Eastern Radio Controlled Car Club");
    assert.equal(names("South Eastern RC Car Club", AU)[0], "South Eastern Radio Controlled Car Club");
    assert.equal(names("EMCC", AU)[0], "Eastern Model Car Club");
    assert.equal(find("SERCCC", AU)[0].why, "LiveRC name");
  });

  it("keeps two real clubs with nearly the same name both reachable", () => {
    // RC Madness and RC Madness 2 share one Enfield, CT address. Typing either offers the right one first.
    assert.deepEqual(names("RC Madness", US), ["RC Madness", "RC Madness 2"]);
    assert.equal(names("RC Madness 2", US)[0], "RC Madness 2");
    assert.equal(names("Madness", US).length, 2);
  });

  it("never offers a club whose number disagrees", () => {
    assert.deepEqual(names("RC Madness 3", US), ["RC Madness"]);
  });

  it("puts the driver's own country first and hides weak foreign matches", () => {
    // An Australian typing "Knox RC" sees Knox Offroad, not the Mini-Z club in Knoxville...
    assert.deepEqual(names("Knox RC", AU), ["Knox Offroad RC Club"]);
    // ...unless they type that club's own words, which is a strong enough match from anywhere.
    assert.equal(names("Mini-Z Knox", AU)[0], "Mini-Z Knox");
    // A stronger match still leads: "Knox" is all of Knox Offroad’s name, only part of Mini-Z Knox.
    assert.deepEqual(names("Knox", US), ["Knox Offroad RC Club", "Mini-Z Knox"]);
  });

  it("uses the typed town to break ties, not to invent matches", () => {
    const withTown = find("Knox Offroad", { ...AU, location: "Knoxfield" });
    assert.equal(withTown[0].row.name, "Knox Offroad RC Club");
    assert.ok(withTown[0].score > find("Knox Offroad", AU)[0].score);
    // A shared place word is not a shared club, even in the same town.
    assert.deepEqual(names("Eastern Hills RC", { ...AU, location: "Melbourne" }), []);
  });

  it("returns nothing for filler, prefixes and scraps", () => {
    assert.deepEqual(names("RC Raceway Club", AU), []);
    assert.deepEqual(names("Knoxville", US), []);
    assert.deepEqual(names("Kn", AU), []);
    assert.deepEqual(names("", AU), []);
    assert.deepEqual(names("Eastern Hills RC", AU), []);
  });

  it("offers at most three", () => {
    const many = trackLookalikeFinder(
      Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, name: `Madness Park ${i === 0 ? "" : "Annex"}`.trim(), countryCode: "us" }))
    );
    assert.ok(many("Madness", US).length <= 3);
  });
});
