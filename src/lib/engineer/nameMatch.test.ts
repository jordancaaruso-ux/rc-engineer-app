/**
 * Run: `npm run test:engineer-history`.
 *
 * The matcher attaches a meeting or a track the driver NAMED, with typos forgiven — and must
 * not attach one they didn't. A false match is visible on the bar, but it still costs a
 * question, so the misses matter as much as the hits.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { editDistance, matchDriverName, matchNamedScope } from "@/lib/engineer/nameMatch";

const DRIVERS = ["Jordan Caruso", "Tim Hilyear", "Sam Hilyear", "Bob Jones", "Lee Vo"];

test("a driver is found by surname, typo and all; two who share it need a first name", () => {
  assert.equal(matchDriverName("what was my average delta to tim hilyear", DRIVERS), "Tim Hilyear");
  assert.equal(matchDriverName("how do I compare to hillyear", DRIVERS), null, "two Hilyears, no first name");
  assert.equal(matchDriverName("versus sam hilyear", DRIVERS), "Sam Hilyear");
  assert.equal(matchDriverName("am I quicker than jones?", DRIVERS), "Bob Jones");
  assert.equal(matchDriverName("the car is loose on exit", DRIVERS), null);
  assert.equal(matchDriverName("compare me to vo", DRIVERS), null, "a two-letter surname is never matched");
});

const NAMES = {
  events: [
    { id: "sa26", name: "SA State Titles 2026", from: "2026-09-11" },
    { id: "qld26", name: "2026 QLD State Titles", from: "2026-06-26" },
    { id: "nsw26", name: "NSW State Titles", from: "2026-05-01" },
    { id: "nsw25", name: "NSW State Titles", from: "2025-05-02" },
    { id: "club", name: "Club Round 3", from: "2026-08-01" },
  ],
  tracks: [
    { id: "tftr", name: "TFTR" },
    { id: "keilor", name: "Keilor" },
    { id: "rrcsa", name: "Radio Racing Cars SA" },
    { id: "bay", name: "Bayside" },
  ],
};

test("edit distance counts a swap as one slip", () => {
  assert.equal(editDistance("titles", "titels"), 1);
  assert.equal(editDistance("keilor", "kielor"), 1);
  assert.equal(editDistance("bayside", "bayside"), 0);
  assert.equal(editDistance("tftr", "tfrt"), 1);
});

test("a meeting named in the message is found, case and punctuation aside", () => {
  assert.equal(matchNamedScope("search sa state titles", NAMES)?.id, "sa26");
  assert.equal(matchNamedScope("How did the SA State Titles go?", NAMES)?.id, "sa26");
  assert.equal(matchNamedScope("what worked at the qld state titles", NAMES)?.id, "qld26");
});

test("typos are forgiven — one slip on a short word, two on a long one", () => {
  assert.equal(matchNamedScope("sa state titels", NAMES)?.id, "sa26");
  assert.equal(matchNamedScope("look at my kielor runs", NAMES)?.id, "keilor");
  assert.equal(matchNamedScope("baysdie", NAMES)?.id, "bay");
});

test("a four-letter name needs an exact hit — TFTR is not tfrt", () => {
  assert.equal(matchNamedScope("how do I set up for tftr", NAMES)?.id, "tftr");
  assert.equal(matchNamedScope("how do I set up for tfrt", NAMES), null);
});

test("a yearly repeat picks the most recent, and a year in the message picks that year", () => {
  assert.equal(matchNamedScope("nsw state titles", NAMES)?.id, "nsw26");
  assert.equal(matchNamedScope("nsw state titles 2025", NAMES)?.id, "nsw25");
});

test("the meeting beats its own track, and part of a long name is enough", () => {
  assert.equal(matchNamedScope("sa state titles at radio racing cars", NAMES)?.id, "sa26");
  assert.equal(matchNamedScope("my runs at radio racing cars", NAMES)?.id, "rrcsa");
});

test("nothing is attached for questions that name no meeting or track", () => {
  assert.equal(matchNamedScope("the car is loose on exit, what do I change?", NAMES), null);
  assert.equal(matchNamedScope("how did I go at the nationals last year", NAMES), null);
  assert.equal(matchNamedScope("state titles", NAMES), null, "'state titles' alone names three meetings and none");
  assert.equal(matchNamedScope("sa", NAMES), null);
  assert.equal(matchNamedScope("", NAMES), null);
});
