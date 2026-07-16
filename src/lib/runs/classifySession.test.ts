import assert from "node:assert/strict";
import test from "node:test";
import { classifySession, applySessionClassification } from "./classifySession";

test("classifySession — practice variants", () => {
  for (const name of ["Practice 1", "Controlled Practice", "Open Practice", "Practice — Round 2"]) {
    const r = classifySession(name);
    assert.equal(r.meetingSessionType, "PRACTICE", name);
    assert.equal(r.confident, true, name);
  }
});

test("classifySession — qualifiers (incl. seeding/bump/LCQ folded to QUALIFYING)", () => {
  const quals: Array<[string]> = [["Qualifier 3"], ["Qualifying Round 4"], ["Q2"], ["Q 5"], ["Seeding"], ["Bump-up"], ["LCQ"], ["Last Chance Qualifier"]];
  for (const [name] of quals) {
    const r = classifySession(name);
    assert.equal(r.meetingSessionType, "QUALIFYING", `${name} -> ${r.meetingSessionType}`);
    assert.equal(r.confident, true, name);
  }
});

test("classifySession — mains keep letter, collapse legs", () => {
  const cases: Array<[string, string]> = [
    ["A Main", "A"],
    ["A-Main", "A"],
    ["A-Main · Leg 2", "A"],
    ["A Main Leg 3", "A"],
    ["B Main", "B"],
    ["Main C", "C"],
    ["Lower A Main", "A"],
  ];
  for (const [name, letter] of cases) {
    const r = classifySession(name);
    assert.equal(r.meetingSessionType, "RACE", name);
    assert.equal(r.mainLetter, letter, name);
    assert.equal(r.sessionLabel, `${letter} Main`, name);
    assert.equal(r.confident, true, name);
  }
});

test("classifySession — bare main / feature default to A main", () => {
  for (const name of ["Main Event", "Feature", "The Main"]) {
    const r = classifySession(name);
    assert.equal(r.meetingSessionType, "RACE", name);
    assert.equal(r.mainLetter, "A", name);
    assert.equal(r.confident, true, name);
  }
});

test("classifySession — ambiguous 'Round N' is low-confidence (won't override)", () => {
  for (const name of ["Round 1", "Round 3", "R2"]) {
    const r = classifySession(name);
    assert.equal(r.confident, false, name);
  }
});

test("classifySession — unknown / empty is low-confidence, null type", () => {
  for (const name of ["Warm Up", "", "   ", "Tech Inspection"]) {
    const r = classifySession(name);
    assert.equal(r.confident, false, JSON.stringify(name));
    assert.equal(r.meetingSessionType, null, JSON.stringify(name));
  }
});

test("applySessionClassification — confident match corrects a mismatched pick", () => {
  const cls = classifySession("A-Main · Leg 2");
  const res = applySessionClassification(cls, { meetingSessionType: "QUALIFYING", sessionLabel: "Qualifier 3" });
  assert.equal(res.meetingSessionType, "RACE");
  assert.equal(res.sessionLabel, "A Main");
  assert.equal(res.changed, true);
});

test("applySessionClassification — confident match that already agrees reports no change", () => {
  const cls = classifySession("Qualifier 3");
  const res = applySessionClassification(cls, { meetingSessionType: "QUALIFYING", sessionLabel: "Qualifier 3" });
  assert.equal(res.changed, false);
  assert.equal(res.meetingSessionType, "QUALIFYING");
});

test("applySessionClassification — low confidence never overwrites the driver's pick", () => {
  const cls = classifySession("Round 1");
  const res = applySessionClassification(cls, { meetingSessionType: "PRACTICE", sessionLabel: "My practice" });
  assert.equal(res.meetingSessionType, "PRACTICE");
  assert.equal(res.sessionLabel, "My practice");
  assert.equal(res.changed, false);
});
