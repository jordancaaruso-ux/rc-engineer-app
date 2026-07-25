/**
 * Proves each axis actually changes the generated world. The stale-setup case matters most:
 * if it silently still varied the setup, the "sheet didn't keep up with reality" hole could
 * never be found. Run: npm run test:grader
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSkeleton, type FactoryInputs } from "./scenarioFactory";
import { checkRules } from "./coherenceGate";
import type { Scenario } from "./types";

const BASE: Scenario = {
  id: "seed-test",
  version: 1,
  source: "seed",
  question: "seed question",
  mode: "normal",
  world: {
    car: { name: "A800RR", setupSheetTemplate: "awesomatix_a800rr" },
    track: { name: "Indoor Carpet", gripTags: ["MEDIUM"] },
    tireSet: { label: "Set 3", tireType: { displayName: "Test Tire", modelCode: "TT-1" } },
    runs: [
      {
        setupData: {
          camber_front: -1.5,
          camber_rear: -1,
          damper_oil_front: 550,
          damper_oil_rear: 500,
          spring_front: 2.4,
          upper_inner_shims_rf: 1,
          arb_rear: 1.3,
        },
        lapTimes: [12.4, 12.1, 12.3, 12.2],
        carRating: 7,
      },
    ],
    focusRunIndex: 0,
  },
};

function inputs(over: Partial<FactoryInputs> = {}): FactoryInputs {
  return {
    base: BASE,
    archetype: "completionist",
    historyDepth: "single-day",
    setupFreshness: "fresh",
    questionShape: "pointed",
    problemType: "mid-understeer",
    carFamiliarity: "template",
    gripLevel: "HIGH",
    index: 1,
    ...over,
  };
}

const setupsOf = (s: Scenario) => s.world.runs.map((r) => JSON.stringify(r.setupData));

test("stale setup keeps every run's sheet identical (the silent-killer case)", () => {
  const s = buildSkeleton(inputs({ setupFreshness: "stale" }));
  assert.ok(s.world.runs.length > 1, "need a chain to compare");
  const unique = new Set(setupsOf(s));
  assert.equal(unique.size, 1, "stale must produce an EMPTY setup diff across runs");
});

test("fresh setup changes between runs", () => {
  const s = buildSkeleton(inputs({ setupFreshness: "fresh" }));
  assert.ok(new Set(setupsOf(s)).size > 1, "fresh must actually vary the sheet");
});

test("partial freshness only moves big keys, never shims/ARB", () => {
  const s = buildSkeleton(inputs({ setupFreshness: "partial", index: 4 }));
  const first = s.world.runs[0].setupData;
  for (const r of s.world.runs) {
    assert.equal(r.setupData.upper_inner_shims_rf, first.upper_inner_shims_rf, "shims must stay unlogged");
    assert.equal(r.setupData.arb_rear, first.arb_rear, "ARB must stay unlogged");
  }
});

test("history depth controls run count", () => {
  assert.equal(buildSkeleton(inputs({ historyDepth: "single-run" })).world.runs.length, 1);
  const day = buildSkeleton(inputs({ historyDepth: "single-day" })).world.runs.length;
  assert.ok(day >= 4 && day <= 6, `single-day should be 4–6 runs, got ${day}`);
  const season = buildSkeleton(inputs({ historyDepth: "season" })).world.runs.length;
  assert.ok(season >= 8, `season should be 8+, got ${season}`);
});

test("archetype strips the right fields from generated runs", () => {
  const min = buildSkeleton(inputs({ archetype: "minimalist" }));
  const focus = min.world.runs[min.world.focusRunIndex];
  assert.equal(focus.handlingAssessmentJson, undefined);
  assert.equal(focus.carRating, null);

  const comp = buildSkeleton(inputs({ archetype: "completionist" }));
  assert.ok(comp.world.runs[comp.world.focusRunIndex].handlingAssessmentJson);

  const noTiming = buildSkeleton(inputs({ archetype: "no-timing" }));
  assert.deepEqual(noTiming.world.runs[0].lapTimes, []);
});

test("sparse car familiarity removes the setup-sheet template", () => {
  const s = buildSkeleton(inputs({ carFamiliarity: "sparse" }));
  assert.equal(s.world.car.setupSheetTemplate, null);
});

test("mode is always normal — the axis was deliberately removed", () => {
  for (const shape of ["trackside-urgent", "debrief", "vague"] as const) {
    assert.equal(buildSkeleton(inputs({ questionShape: shape })).mode, "normal");
  }
});

test("generated scenarios pass the structural rules", () => {
  for (let i = 0; i < 25; i++) {
    const s = buildSkeleton(inputs({ index: i }));
    assert.equal(checkRules(s), null, `scenario ${i} failed structural rules`);
  }
});

test("sparse worlds are never rejected for being empty", () => {
  const s = buildSkeleton(inputs({ archetype: "minimalist", historyDepth: "single-run" }));
  assert.equal(checkRules(s), null, "a thin-data user is a real user, not an incoherent one");
});

test("single-run scenarios never claim a stale setup (nothing to be stale against)", () => {
  for (const f of ["stale", "partial"] as const) {
    const s = buildSkeleton(inputs({ historyDepth: "single-run", setupFreshness: f }));
    assert.equal(s.world.runs.length, 1);
    assert.equal(s.axes?.setupFreshness, "fresh", `${f} must normalize to fresh for a lone run`);
  }
});

test("questions come from the bank and vary across scenarios", () => {
  const bank = {
    params: ["rear toe"],
    symptomPhrases: { "mid-understeer": ["pushing mid-corner", "washing out mid-corner"] },
    shapes: { pointed: ["A: {symptom}?", "B: {symptom}?", "C: {symptom}?", "D: {symptom}?"] },
  };
  const qs = new Set<string>();
  for (let i = 0; i < 20; i++) {
    qs.add(buildSkeleton(inputs({ index: i, questionBank: bank, questionShape: "pointed" })).question);
  }
  assert.ok(qs.size > 1, "the bank must actually vary the wording across scenarios");
  for (const q of qs) assert.ok(!q.includes("{"), `unfilled placeholder in: ${q}`);
});

test("no bank entry leaves a dangling reference to advice never given", () => {
  // Every question is the FIRST message in a thread: "I don't buy that" would be
  // answering something the engine never said, and the confusion would read as a flaw.
  const bank = JSON.parse(
    require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "scripts/engineer-grader-eval/questionBank.json"),
      "utf8"
    )
  ) as { shapes: Record<string, string[]> };
  // Only bare demonstratives with no antecedent — a pronoun bound to {param} is fine
  // ("understand {param}… why does it affect the car" reads correctly).
  const dangling = [
    /\bwhat that\b/i,
    /\bbuy that\b/i,
    /\bwould that\b/i,
    /\bthat actually does\b/i,
    /\btry that\b/i,
    /\bwhy that\b/i,
  ];
  for (const [shape, variants] of Object.entries(bank.shapes)) {
    for (const v of variants) {
      for (const re of dangling) {
        assert.ok(!re.test(v), `${shape} variant has a dangling reference (${re}): "${v}"`);
      }
    }
  }
});

test("every symptom phrase reads correctly after \"It's …\"", () => {
  // Templates say "It's {symptom}" / "Car is {symptom}", so a full clause like
  // "no grip left by the end" produces "It's no grip left by the end".
  const bank = JSON.parse(
    require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "scripts/engineer-grader-eval/questionBank.json"),
      "utf8"
    )
  ) as { symptomPhrases: Record<string, string[]> };
  for (const [problem, phrases] of Object.entries(bank.symptomPhrases)) {
    for (const p of phrases) {
      assert.ok(
        !/^(no|the|a|an|my)\b/i.test(p),
        `${problem} phrase starts with a determiner so "It's ${p}" is broken: "${p}"`
      );
    }
  }
});

test("a pooled setup replaces the seed's sheet and its chassis template", () => {
  const entry = {
    id: "doc-abc",
    setupSheetTemplate: "xray_x4",
    trackSurface: "asphalt",
    data: { camber_front: -2.5, damper_oil_rear: 700, spring_front: 3.1 },
    source: "setup-document" as const,
    keyCount: 3,
  };
  const s = buildSkeleton(inputs({ setupEntry: entry }));
  const first = s.world.runs[0].setupData;
  assert.equal(first.camber_front, -2.5, "must start from the pooled sheet, not the seed's");
  assert.equal(s.world.car.setupSheetTemplate, "xray_x4", "chassis follows the pooled sheet");
  assert.ok(
    s.perturbation?.some((p) => p.op === "setupFromPool"),
    "provenance must record which pooled sheet was used"
  );
});

test("sparse familiarity still strips the template even with a pooled sheet", () => {
  const entry = {
    id: "doc-xyz",
    setupSheetTemplate: "xray_x4",
    data: { camber_front: -2, damper_oil_rear: 600 },
    source: "setup-document" as const,
    keyCount: 2,
  };
  const s = buildSkeleton(inputs({ setupEntry: entry, carFamiliarity: "sparse" }));
  assert.equal(s.world.car.setupSheetTemplate, null);
});

test("feel-vs-data conflict makes the focus run faster but rated worse", () => {
  const s = buildSkeleton(inputs({ dataConflict: "felt-worse-but-faster", archetype: "typical" }));
  const focus = s.world.runs[s.world.focusRunIndex];
  const prev = s.world.runs[s.world.focusRunIndex - 1];
  assert.ok(focus.bestLapSeconds! < prev.bestLapSeconds!, "focus run must actually be faster");
  assert.ok(focus.carRating! < 5, "…while the driver rated it worse");
});
