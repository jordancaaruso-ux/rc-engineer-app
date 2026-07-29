/**
 * Loader coverage for the unanchored (degraded-path) stratum: the bench loads
 * scenarios/ + scenarios/unanchored/ + seed/, and every unanchored scenario must carry
 * the flag the bench keys off (runId withheld) plus the tag the trust metrics stratify by.
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { loadScenarios, loadScenariosFromDirs } from "./scenarioIo";

const ROOT = path.join(process.cwd(), "scripts/engineer-grader-eval");
const SCENARIOS_DIR = path.join(ROOT, "scenarios");
const UNANCHORED_DIR = path.join(SCENARIOS_DIR, "unanchored");
const SEED_DIR = path.join(ROOT, "seed");

test("unanchored dir loads and every scenario is flagged + tagged", async () => {
  const un = await loadScenarios(UNANCHORED_DIR);
  assert.ok(un.length >= 10, `expected >= 10 unanchored scenarios, got ${un.length}`);
  for (const s of un) {
    assert.equal(s.unanchored, true, `${s.id} missing unanchored: true`);
    assert.ok((s.tags ?? []).includes("degraded-path"), `${s.id} missing degraded-path tag`);
    assert.ok(s.question.trim().length > 0, `${s.id} empty question`);
    assert.ok(s.world.runs.length > 0, `${s.id} empty world`);
  }
});

test("bench dir list dedupes cleanly — unanchored ids collide with nothing", async () => {
  const all = await loadScenariosFromDirs([SCENARIOS_DIR, UNANCHORED_DIR, SEED_DIR]);
  const unIds = (await loadScenarios(UNANCHORED_DIR)).map((s) => s.id);
  const loadedIds = new Set(all.map((s) => s.id));
  for (const id of unIds) {
    assert.ok(loadedIds.has(id), `${id} lost in combined load`);
  }
  assert.equal(loadedIds.size, all.length, "duplicate scenario ids in combined load");
});

test("anchored corpus scenarios never carry the unanchored flag", async () => {
  const main = await loadScenarios(SCENARIOS_DIR);
  for (const s of main) {
    assert.notEqual(s.unanchored, true, `${s.id} in scenarios/ root must not be unanchored`);
  }
});
