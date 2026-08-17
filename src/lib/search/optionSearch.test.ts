/**
 * Run: `npx tsx --test src/lib/search/optionSearch.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countOptions,
  filterOptionSections,
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

test("naming one option of a family ranks it first, siblings below", () => {
  // "Sweep 32" shares a token with "sweep 36" and stays on screen at a lower
  // rank. Deliberate: the neighbouring compound is often what you meant, and a
  // list that empties itself down to one row is a list you can't correct from.
  const out = filterOptionSections("sweep 36", sections([], ALL))[0]!.options;
  assert.equal(out[0]!.value, SWEEP_36.value);
  assert.equal(out[1]!.value, SWEEP_32.value);
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
  const out = filterOptionSections("sweep 36", sections([], ALL))[0]!.options;
  assert.equal(out[0]!.value, SWEEP_36.value, "exact match wins even though Sweep 32 is listed first");
});
