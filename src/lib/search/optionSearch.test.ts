/**
 * Run: `npx tsx --test src/lib/search/optionSearch.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countOptions,
  filterOptionSections,
  matchesEveryWord,
  normalizeSearchText,
  scoreSearchMatch,
  type OptionSection,
} from "@/lib/search/optionSearch";

const opt = (value: string, label: string, keywords?: string, detail?: string) => ({
  value,
  label,
  keywords,
  detail,
});

const SWEEP_32 = opt("a", "Sweep 32", "SWEEP-32");
const SWEEP_36 = opt("b", "Sweep 36", "SWEEP-36");
const M4_SOFT = opt("c", "Pro-Line M4 Super Soft", "PRO-LINE-M4-SUPER-SOFT");
const M4_MED = opt("d", "Pro-Line M4 Medium", "PRO-LINE-M4-MEDIUM");
const REFLEX = opt("e", "JConcepts Reflex 2.2", "JCONCEPTS-REFLEX-2-2");

const ALL = [SWEEP_32, SWEEP_36, M4_SOFT, M4_MED, REFLEX];

const sections = (recent: typeof ALL, all: typeof ALL): OptionSection[] => [
  { key: "recent", label: "Recently used", options: recent },
  { key: "all", label: "All types", options: all },
];

test("normalizing strips case, punctuation and a trailing set number", () => {
  assert.equal(normalizeSearchText("  Sweep 32 #2  "), "sweep 32");
  assert.equal(normalizeSearchText("Pro-Line M4"), "pro line m4");
  assert.equal(normalizeSearchText("!!!"), "");
});

test("an empty query scores nothing, so it can't rank a list", () => {
  assert.equal(scoreSearchMatch("", ["Sweep 32", "SWEEP-32"]), 0);
  assert.equal(scoreSearchMatch("   ", ["Sweep 32"]), 0);
});

test("hidden fields are searched — a code that never appears on screen still matches", () => {
  assert.equal(scoreSearchMatch("d32", ["Sweep Racing Purple", "D32"]), 100);
  assert.equal(scoreSearchMatch("d32", ["Sweep Racing Purple", null]), 0);
});

test("browse view keeps the caller's sections, and never repeats an option", () => {
  const out = filterOptionSections("", sections([M4_MED], ALL));
  assert.deepEqual(
    out.map((s) => s.label),
    ["Recently used", "All types"]
  );
  assert.deepEqual(out[0]!.options, [M4_MED]);
  assert.ok(!out[1]!.options.some((o) => o.value === M4_MED.value));
  assert.equal(countOptions(out), ALL.length);
});

test("an empty leading section drops out rather than showing a bare heading", () => {
  const out = filterOptionSections("", sections([], ALL));
  assert.equal(out.length, 1);
  assert.equal(out[0]!.label, null, "the only section loses its heading — the sheet title says it");
  assert.equal(out[0]!.options.length, ALL.length);
});

test("typing collapses the groups to one ranked list", () => {
  const out = filterOptionSections("m4", sections([M4_MED], ALL));
  assert.equal(out.length, 1);
  assert.equal(out[0]!.key, "results");
  assert.deepEqual(
    out[0]!.options.map((o) => o.label).sort(),
    ["Pro-Line M4 Medium", "Pro-Line M4 Super Soft"]
  );
});

test("a partial name narrows as you type — the scroll this replaces", () => {
  assert.equal(countOptions(filterOptionSections("", sections([], ALL))), 5);
  assert.equal(countOptions(filterOptionSections("sw", sections([], ALL))), 2);
  assert.equal(countOptions(filterOptionSections("pro-line m4", sections([], ALL))), 2);
});

test("naming one option of a family finds that one, not a sibling that shares a word", () => {
  // Until 2026-09-26 "Sweep 32" stayed on screen for "sweep 36" on the one word it shares. The
  // launch test drive showed where that leads ("TT-02" offering an F1 car), and the founder
  // ruled every typed word must match.
  const out = filterOptionSections("sweep 36", sections([], ALL))[0]!.options;
  assert.deepEqual(
    out.map((o) => o.value),
    [SWEEP_36.value]
  );
});

test("earlier sections break ties, so recents and favourites come first", () => {
  const withRecent = filterOptionSections("sweep", sections([SWEEP_36], ALL));
  assert.equal(withRecent[0]!.options[0]!.value, SWEEP_36.value);
  const withoutRecent = filterOptionSections("sweep", sections([], ALL));
  assert.equal(withoutRecent[0]!.options[0]!.value, SWEEP_32.value);
});

test("an exact name outranks a merely-containing one", () => {
  const out = filterOptionSections("Sweep 32", sections([], ALL))[0]!.options;
  assert.equal(out[0]!.value, SWEEP_32.value);
});

test("the detail line is searchable — a track's town, not just its club name", () => {
  const tracks: OptionSection[] = [
    {
      key: "all",
      label: null,
      options: [
        opt("t1", "Gepps Cross", undefined, "Adelaide, SA"),
        opt("t2", "Logan City", undefined, "Brisbane, QLD"),
      ],
    },
  ];
  const out = filterOptionSections("adelaide", tracks);
  assert.equal(countOptions(out), 1);
  assert.equal(out[0]!.options[0]!.value, "t1");
});

test("no match returns nothing, which is what offers the create row", () => {
  const out = filterOptionSections("zzzz", sections([SWEEP_32], ALL));
  assert.deepEqual(out, []);
  assert.equal(countOptions(out), 0);
});

test("whitespace-only input is still the browse view", () => {
  const out = filterOptionSections("   ", sections([SWEEP_32], ALL));
  assert.equal(out[0]!.label, "Recently used");
});

test("equal scores keep the caller's order, so a run list stays newest-first", () => {
  /*
   * The picker prints "<driver> · <event> — <session> — <track>", and searching a
   * teammate's name matches every one of their runs identically. Ranked
   * alphabetically that put "ETS Round 1" above "Testing 16 Aug 2026" — E before
   * T — and the newest run landed at the bottom of the list.
   */
  const runs: OptionSection[] = [
    {
      key: "all",
      label: null,
      options: [
        opt("newest", "Dayne Warren · Testing 16 Aug 2026 — Run — MR33 Arena"),
        opt("older", "Dayne Warren · ETS Round 1 — Qualifying — Apeldoorn"),
        opt("oldest", "Dayne Warren · ETS Round 1 — Practice — Apeldoorn"),
      ],
    },
  ];
  assert.deepEqual(
    filterOptionSections("dayne", runs)[0]!.options.map((o) => o.value),
    ["newest", "older", "oldest"]
  );
});

test("a better score still outranks the caller's order", () => {
  const soft = opt("f", "Sweep 36 Soft", "SWEEP-36-SOFT");
  const out = filterOptionSections("sweep 36", sections([], [soft, ...ALL]))[0]!.options;
  assert.deepEqual(
    out.map((o) => o.value),
    [SWEEP_36.value, soft.value],
    "exact match wins even though Sweep 36 Soft is listed first"
  );
});

/*
 * The launch test drive (2026-09-26): each search below listed something that shared only one
 * word or number with what was typed. Every typed word must match now, and numbers whole.
 */

/** One unsectioned list, the way a catalog picker hands it over. */
const list = (...options: ReturnType<typeof opt>[]): OptionSection[] => [
  { key: "all", label: null, options },
];
const found = (query: string, from: OptionSection[]) =>
  (filterOptionSections(query, from)[0]?.options ?? []).map((o) => o.label);

test("TT-02 no longer offers a Formula car that only shares the 02 (test drive 12-1)", () => {
  const chassis = [
    opt("f1", "CapricornRC LAB F101 F1-02", "capricornrc lab f101 f1 02"),
    opt("x4", "Xray X4'25", "xray x4 25"),
  ];
  assert.deepEqual(found("TT-02", list(...chassis)), []);
  const withTamiya = list(...chassis, opt("tt", "Tamiya TT-02", "tamiya tt 02"));
  assert.deepEqual(found("TT-02", withTamiya), ["Tamiya TT-02"]);
  assert.deepEqual(found("tt02", withTamiya), ["Tamiya TT-02"], "typed without the dash");
});

test("RC Madness lists the RC Madness clubs, not every club with RC in its name (21-1)", () => {
  const rows = [
    opt("a", "207 RC Speedway"),
    opt("b", "21 Jump Street RC"),
    opt("c", "517 RC Motorplex"),
    opt("d", "RC MAD Mackay"),
    opt("e", "RC Madness 2"),
    opt("f", "RC Madness"),
  ];
  const tracks = list(...rows);
  const out = filterOptionSections("RC Madness", tracks);
  assert.deepEqual(
    out[0]!.options.map((o) => o.label),
    ["RC Madness", "RC Madness 2"],
    "the exact name first, though the list had it second"
  );
  assert.equal(countOptions(out), 2, "the count is real matches only");
  assert.deepEqual(found("rc madn", tracks), ["RC Madness 2", "RC Madness"], "half-typed");
  // A hidden LiveRC host is glued words; "madness" inside "minizmadness" is chance, not a name.
  const withHost = list(...rows, opt("g", "West Bend Mini RC", "minizmadness"));
  assert.deepEqual(found("RC Madness", withHost), ["RC Madness", "RC Madness 2"]);
});

test("SC6.4 finds the SC6.4, not chassis that merely have a 4 in them (22-2)", () => {
  const chassis = list(
    opt("a", "Axon TC10/4", "axon tc10 4"),
    opt("b", "ARC R8.4", "arc r8 4"),
    opt("c", "Associated SC6.4", "associated sc6 4"),
    opt("d", "WRC Racing F-One F18.4", "wrc racing f one f18 4"),
    opt("e", "WRC Racing SBX.4", "wrc racing sbx 4")
  );
  assert.deepEqual(found("SC6.4", chassis), ["Associated SC6.4"]);
});

test("1/12 finds 1/12 tires or nothing, never 1/10 ones (26-1)", () => {
  const tires = [
    opt("a", "BSR 1/10 Pan Front", "BSR-1-10-PAN-FRONT"),
    opt("b", "Hot Race 1/10 Pan Rear", "HOT-RACE-1-10-PAN-REAR"),
    opt("c", "CRC RT-1 Front", "CRC-RT-1-FRONT"),
  ];
  assert.deepEqual(found("1/12", list(...tires)), []);
  assert.deepEqual(found("1/12", list(...tires, opt("d", "CRC 1/12 Front", "CRC-1-12-FRONT"))), [
    "CRC 1/12 Front",
  ]);
});

test("a number only ever matches a whole number", () => {
  assert.equal(matchesEveryWord("3", ["Sweep 36"]), false, "not the start of 36");
  assert.equal(matchesEveryWord("36", ["Sweep 36"]), true);
  assert.equal(matchesEveryWord("32", ["Sweep D32"]), true, "the number in a code still counts");
  assert.equal(matchesEveryWord("d3", ["Sweep D32"]), false);
  assert.equal(matchesEveryWord("4", ["Club Champs 2024"]), false, "not a digit inside a year");
  assert.equal(matchesEveryWord("10", ["Axon TC10/4"]), true);
  assert.equal(matchesEveryWord("B64", ["Associated B6.4"]), false, "6.4 is two numbers, not 64");
  assert.equal(matchesEveryWord("B6.4", ["Associated B64"]), false, "and 64 is not 6.4");
  assert.equal(matchesEveryWord("B6.4", ["Associated B6.4"]), true);
  assert.deepEqual(filterOptionSections("sweep 3", sections([], ALL)), [], "half a number finds nothing");
});

test("words match from their start, in any order, across the option's fields", () => {
  assert.equal(matchesEveryWord("jcon refl", ["JConcepts Reflex 2.2"]), true, "still being typed");
  assert.equal(matchesEveryWord("madness rc", ["RC Madness"]), true, "any order");
  assert.equal(matchesEveryWord("gepps adelaide", ["Gepps Cross", "Adelaide, SA"]), true, "name and town");
  assert.equal(matchesEveryWord("rc", ["Marcus Circuit"]), false, "a short word can't hide inside one");
  assert.equal(matchesEveryWord("hot", ["Pro-Line Hole Shot 2.0 M4"]), false);
  assert.equal(matchesEveryWord("sweap 36", ["Sweep 36"]), false, "no typo tolerance");
  assert.equal(matchesEveryWord("", ["Sweep 36"]), false);
});

test("four letters or more may sit inside a longer word of the shown name, never of a hidden code", () => {
  assert.equal(matchesEveryWord("grp soft", ["GRP Block N25 SuperSoft"]), true);
  assert.equal(matchesEveryWord("raceway", ["Apexraceway"]), true);
  assert.equal(matchesEveryWord("ride", ["VP-Pro Hybrid Evo MS2"]), false, "not across two words");
  assert.equal(matchesEveryWord("madness", ["West Bend Mini RC"], ["minizmadness"]), false);
  assert.equal(matchesEveryWord("miniz", ["West Bend Mini RC"], ["minizmadness"]), true, "a host still matches from its start");
});

test("words typed together or apart still find each other", () => {
  assert.equal(matchesEveryWord("proline m4", ["Pro-Line M4 Medium"]), true);
  assert.equal(matchesEveryWord("sweep32", ["Sweep 32"]), true);
  assert.equal(matchesEveryWord("off road", ["Knox Offroad RC Club"]), true);
  assert.equal(matchesEveryWord("j concepts reflex", ["JConcepts Reflex 2.2"]), true);
  assert.equal(matchesEveryWord("x4 25", ["Xray X4'25"]), true);
});

test("ordinary searches still find what they should", () => {
  const tracks = list(
    opt("t1", "Knox Offroad RC Club", undefined, "Melbourne, VIC"),
    opt("t2", "Canowindra Model Car Club", undefined, "Canowindra, NSW"),
    opt("t3", "Indoor Raceway Stevenage", undefined, "Stevenage")
  );
  assert.deepEqual(found("knox", tracks), ["Knox Offroad RC Club"]);
  assert.deepEqual(found("Canowindra", tracks), ["Canowindra Model Car Club"]);
  assert.deepEqual(found("stevenage raceway", tracks), ["Indoor Raceway Stevenage"]);
  assert.deepEqual(found("club", tracks), ["Knox Offroad RC Club", "Canowindra Model Car Club"]);
  assert.deepEqual(found("melbourne", tracks), ["Knox Offroad RC Club"], "the town line");

  const chassis = list(
    opt("c1", "Xray X4'25", "xray x4 25"),
    opt("c2", "Schumacher Eclipse6", "schumacher eclipse6"),
    opt("c3", "Schumacher Cat PB", "schumacher cat pb")
  );
  assert.deepEqual(found("x4", chassis), ["Xray X4'25"]);
  assert.deepEqual(found("eclipse", chassis), ["Schumacher Eclipse6"]);
  assert.deepEqual(found("schumacher", chassis), ["Schumacher Eclipse6", "Schumacher Cat PB"]);

  const tires = list(
    opt("k", "Knox Mob Club Spec Rear Blue", "KNOX-MOB-CLUB-SPEC-REAR-BLUE"),
    opt("s", "Sweep D32", "SWEEP-D32"),
    opt("m", "Pro-Line M4 Super Soft", "PRO-LINE-M4-SUPER-SOFT")
  );
  assert.deepEqual(found("Knox Mob", tires), ["Knox Mob Club Spec Rear Blue"]);
  assert.deepEqual(found("d32", tires), ["Sweep D32"]);
  assert.deepEqual(found("super soft", tires), ["Pro-Line M4 Super Soft"]);
});
