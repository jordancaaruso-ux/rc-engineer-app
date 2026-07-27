/**
 * Scenario factory — builds synthetic context bundles for the flaw hunt.
 *
 * DIVISION OF LABOUR (deliberate): deterministic code owns STRUCTURE, the LLM owns
 * LANGUAGE. Setup values, lap arrays and handling blobs are inherited from Jordan's real
 * runs and perturbed numerically, so they stay physically real by construction — the model
 * never invents a setup sheet. Grok only writes the driver's words and the question.
 *
 * Screening design: every axis varies, nothing is crossed deeply. Jordan can't predict
 * which axis breaks the engine, so the corpus probes every corner once and the annotations
 * reveal where to drill.
 */
import type {
  ArchetypeId,
  HandlingRichness,
  HistoryDepth,
  ProblemTypeId,
  QuestionShapeId,
  Scenario,
  ScenarioAxes,
  ScenarioRun,
  ScenarioWorld,
  SetupFreshness,
  SetupPoolEntry,
} from "./types";
import { ARCHETYPES, applyArchetype, thinSetupData } from "./archetypes";
import { buildHandlingForProblem, withFeelVsLastRun, withSpeedTag } from "./handlingBuilder";
import { QUESTION_SHAPES } from "./questionShapes";
import { llmChat, parseJsonLoose } from "./provider/llmChat";
import type { LlmProviderId } from "./provider/resolveProvider";

export type FactoryInputs = {
  /** A real-run seed scenario supplying genuine setup / lap / tire structure. */
  base: Scenario;
  archetype: ArchetypeId;
  historyDepth: HistoryDepth;
  setupFreshness: SetupFreshness;
  questionShape: QuestionShapeId;
  problemType: ProblemTypeId;
  carFamiliarity: "template" | "sparse";
  gripLevel: "LOW" | "MEDIUM" | "HIGH";
  dataConflict?: string | null;
  /**
   * A real setup sheet from the aggregation pool. When supplied it REPLACES the base
   * seed's setup (and its chassis template), giving the corpus the full mix of chassis
   * and tuning philosophies rather than variations on one driver's own car.
   */
  setupEntry?: SetupPoolEntry | null;
  /** Driver-voice question variants; falls back to the shape's template when absent. */
  questionBank?: QuestionBank | null;
  /** Deterministic variation seed so a corpus is reproducible. */
  index: number;
};

/** Deterministic pseudo-random in [0,1) — keeps corpus generation reproducible. */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export type QuestionBank = {
  params: string[];
  symptomPhrases: Record<string, string[]>;
  shapes: Record<string, string[]>;
};

/** FNV-1a — the sin-based hash clustered badly on small sequential seeds. */
function hashPick(seed: string, length: number): number {
  if (length <= 0) return 0;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % length;
}

/**
 * Pick a question variant and fill its placeholders. Every bank entry must stand alone as a
 * FIRST message — a template saying "I don't buy that" would be asking the engine to answer
 * something it never said, and the resulting confusion would look like a delivery flaw.
 */
export function fillQuestion(
  bank: QuestionBank | null,
  shape: QuestionShapeId,
  problem: ProblemTypeId,
  setupKeys: string[],
  index: number
): string {
  const variants = bank?.shapes?.[shape];
  const template =
    variants && variants.length
      ? variants[hashPick(`q|${shape}|${index}`, variants.length)]
      : QUESTION_SHAPES[shape].fallback;

  const symptoms = bank?.symptomPhrases?.[problem] ?? [];
  const symptom = symptoms.length
    ? symptoms[hashPick(`s|${problem}|${index}`, symptoms.length)]
    : "not feeling right";

  // Prefer a parameter the car actually has on its sheet, so the question is answerable.
  const bankParams = bank?.params ?? [];
  const paramPool = bankParams.length ? bankParams : ["rear toe"];
  const param = paramPool[hashPick(`p|${index}|${setupKeys.length}`, paramPool.length)];

  return template.replace(/\{symptom\}/g, symptom).replace(/\{param\}/g, param);
}

function runCountFor(depth: HistoryDepth, index: number): number {
  if (depth === "single-run") return 1;
  if (depth === "single-day") return 4 + Math.floor(rand(index) * 3); // 4–6, the dominant case
  return 8 + Math.floor(rand(index + 7) * 5); // 8–12 across a season
}

/** Tuning moves a driver plausibly makes between runs. Numeric-only; non-numeric keys skip. */
const TUNING_MOVES: Array<{ key: string; step: number; big: boolean }> = [
  { key: "damper_oil_front", step: 50, big: true },
  { key: "damper_oil_rear", step: 50, big: true },
  { key: "spring_front", step: 0.1, big: true },
  { key: "spring_rear", step: 0.1, big: true },
  { key: "camber_front", step: 0.5, big: true },
  { key: "camber_rear", step: 0.5, big: true },
  { key: "toe_rear", step: 0.25, big: true },
  { key: "ride_height_front", step: 0.5, big: true },
  { key: "ride_height_rear", step: 0.5, big: true },
  { key: "diff_oil", step: 1000, big: true },
  // "Small" moves — the ones a partially-diligent user forgets to log.
  { key: "upper_inner_shims_rf", step: 0.5, big: false },
  { key: "upper_inner_shims_rr", step: 0.5, big: false },
  { key: "under_hub_shims_front", step: 0.5, big: false },
  { key: "under_hub_shims_rear", step: 0.5, big: false },
  { key: "arb_front", step: 0.1, big: false },
  { key: "arb_rear", step: 0.1, big: false },
];

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Apply one plausible tuning move; returns the changed key or null if nothing applied. */
function applyTuningMove(
  data: Record<string, unknown>,
  index: number,
  opts: { bigOnly?: boolean } = {}
): { data: Record<string, unknown>; changedKey: string | null } {
  const candidates = TUNING_MOVES.filter(
    (m) => (!opts.bigOnly || m.big) && asNumber(data[m.key]) != null
  );
  if (candidates.length === 0) return { data: { ...data }, changedKey: null };
  const move = candidates[Math.floor(rand(index) * candidates.length) % candidates.length];
  const current = asNumber(data[move.key])!;
  const direction = rand(index + 3) < 0.5 ? -1 : 1;
  const next = Math.round((current + direction * move.step) * 1000) / 1000;
  return { data: { ...data, [move.key]: next }, changedKey: move.key };
}

/**
 * Build the run chain. `setupFreshness` decides whether the sheet keeps up with reality:
 *  - fresh:   every run's setup reflects what was actually changed
 *  - stale:   setup is IDENTICAL across runs even though feel changes (the silent killer —
 *             the engine's setup diff comes back empty and it reasons as if nothing moved)
 *  - partial: only the big moves are logged; shims/ARB changes happen but aren't recorded
 */
function buildRuns(inputs: FactoryInputs, baseRun: ScenarioRun, count: number): ScenarioRun[] {
  const spec = ARCHETYPES[inputs.archetype];
  const runs: ScenarioRun[] = [];
  let setup = thinSetupData(baseRun.setupData, spec.setupCompleteness);
  const dayStride = inputs.historyDepth === "season" ? 7 : 0;

  for (let i = 0; i < count; i++) {
    const isFocus = i === count - 1;
    const severity: 1 | 2 | 3 = isFocus ? 2 : ((1 + (i % 2)) as 1 | 2);

    if (i > 0 && inputs.setupFreshness !== "stale") {
      const moved = applyTuningMove(setup, inputs.index + i * 13, {
        bigOnly: inputs.setupFreshness === "partial",
      });
      setup = moved.data;
    }

    // Lap times drift from the seed's real distribution; mild degradation as tires age.
    const baseLaps = baseRun.lapTimes.length ? baseRun.lapTimes : [];
    const drift = (rand(inputs.index + i * 5) - 0.4) * 0.25;
    const laps = baseLaps.map((l) => Math.round((l + drift) * 1000) / 1000);

    let handling = buildHandlingForProblem(inputs.problemType, severity);
    handling = withFeelVsLastRun(handling, isFocus ? (inputs.dataConflict === "felt-worse-but-faster" ? -2 : -1) : 0);
    if (rand(inputs.index + i) > 0.6) {
      handling = withSpeedTag(handling, rand(inputs.index + i * 2) > 0.5 ? "slow" : "fast");
    }

    const run: ScenarioRun = {
      label: `Run ${i + 1}`,
      setupData: setup,
      lapTimes: laps,
      bestLapSeconds: laps.length ? Math.min(...laps) : null,
      avgTop5LapSeconds: laps.length
        ? Math.round((laps.slice().sort((a, b) => a - b).slice(0, 5).reduce((s, x) => s + x, 0) /
            Math.min(5, laps.length)) * 1000) / 1000
        : null,
      tireRunNumber: i + 1,
      handlingAssessmentJson: handling.assessment,
      handlingProblems: handling.complaintHint,
      notes: null,
      carRating: isFocus ? 5 : 6,
      conditionsAirTempC: 18 + Math.round(rand(inputs.index + i * 11) * 12),
      conditionsTrackTempC: 22 + Math.round(rand(inputs.index + i * 17) * 14),
      conditionsSource: "manual",
      sortAtOffsetDays: dayStride ? (count - 1 - i) * dayStride : count - 1 - i,
    };

    // "felt worse but was faster" — the conflict the engine must surface honestly.
    if (isFocus && inputs.dataConflict === "felt-worse-but-faster" && laps.length) {
      const faster = laps.map((l) => Math.round((l - 0.35) * 1000) / 1000);
      run.lapTimes = faster;
      run.bestLapSeconds = Math.min(...faster);
      run.carRating = 4;
    }

    runs.push(applyArchetype(run, spec));
  }
  return runs;
}

/** Build the full scenario skeleton — deterministic, no LLM, fully testable. */
export function buildSkeleton(inputs: FactoryInputs): Scenario {
  const spec = ARCHETYPES[inputs.archetype];
  const baseWorld = inputs.base.world;
  const baseRun = baseWorld.runs[baseWorld.focusRunIndex] ?? baseWorld.runs[0];
  if (!baseRun) throw new Error(`Base seed ${inputs.base.id} has no runs`);

  const count = runCountFor(inputs.historyDepth, inputs.index);
  // With a single run there is no previous sheet to be stale against, so "stale"/"partial"
  // would be a silent no-op recorded as a real axis value. Normalize it honestly.
  const effectiveFreshness: SetupFreshness = count < 2 ? "fresh" : inputs.setupFreshness;
  // Some real seeds have no lap times at all, so a "felt worse but was faster" conflict
  // has nothing to stand on. Drop it rather than emit a scenario the gate will reject.
  const seedHasLaps = (baseRun.lapTimes?.length ?? 0) > 0;
  const effectiveConflict = seedHasLaps ? inputs.dataConflict ?? null : null;
  const effectiveInputs: FactoryInputs = {
    ...inputs,
    setupFreshness: effectiveFreshness,
    dataConflict: effectiveConflict,
  };
  // A pooled sheet replaces the seed's setup so the corpus spans many real chassis.
  const seededRun: ScenarioRun = inputs.setupEntry
    ? { ...baseRun, setupData: inputs.setupEntry.data }
    : baseRun;
  const runs = buildRuns(effectiveInputs, seededRun, count);
  const handlingRichness: HandlingRichness = spec.handlingRichness;
  const pooledTemplate = inputs.setupEntry?.setupSheetTemplate ?? baseWorld.car.setupSheetTemplate;

  const world: ScenarioWorld = {
    car: {
      ...baseWorld.car,
      // A "sparse" car has no setup-sheet template, so the engine can't lean on a known schema.
      setupSheetTemplate: inputs.carFamiliarity === "sparse" ? null : pooledTemplate,
      setupSheetModelId: inputs.carFamiliarity === "sparse" ? null : baseWorld.car.setupSheetModelId,
      name: inputs.carFamiliarity === "sparse" ? `${baseWorld.car.name} (unlisted chassis)` : baseWorld.car.name,
    },
    track: { ...baseWorld.track, gripTags: [inputs.gripLevel] },
    trackLayout: baseWorld.trackLayout,
    event: spec.sessionType === "RACE_MEETING" ? baseWorld.event ?? { name: "Club Round", raceClass: null } : null,
    tireSet: baseWorld.tireSet,
    additive: baseWorld.additive,
    runs,
    focusRunIndex: runs.length - 1,
  };

  const axes: ScenarioAxes = {
    archetype: inputs.archetype,
    historyDepth: inputs.historyDepth,
    handlingRichness,
    setupFreshness: effectiveFreshness,
    questionShape: inputs.questionShape,
    problemType: inputs.problemType,
    dataConflict: effectiveConflict,
    gripLevel: inputs.gripLevel,
    carFamiliarity: inputs.carFamiliarity,
  };

  return {
    id: `var-${String(inputs.index).padStart(4, "0")}-${inputs.archetype}-${inputs.questionShape}`,
    version: 1,
    source: "variation",
    baseSeedId: inputs.base.id,
    question: fillQuestion(
      inputs.questionBank ?? null,
      inputs.questionShape,
      inputs.problemType,
      Object.keys(runs[runs.length - 1]?.setupData ?? {}),
      inputs.index
    ),
    // Always "normal": mode is removed from the grid; urgency lives in the question's words.
    mode: "normal",
    world,
    axes,
    perturbation: [
      { op: "archetype", params: { id: inputs.archetype } },
      { op: "historyDepth", params: { depth: inputs.historyDepth, runs: runs.length } },
      { op: "setupFreshness", params: { mode: effectiveFreshness } },
      { op: "problem", params: { type: inputs.problemType } },
      { op: "grip", params: { level: inputs.gripLevel } },
      ...(inputs.setupEntry
        ? [
            {
              op: "setupFromPool",
              params: {
                entryId: inputs.setupEntry.id,
                template: inputs.setupEntry.setupSheetTemplate,
                source: inputs.setupEntry.source,
                keyCount: inputs.setupEntry.keyCount,
              },
            },
          ]
        : []),
    ],
    tags: ["variation", inputs.archetype, inputs.questionShape, inputs.problemType],
  };
}

type NarrationResult = {
  question?: string;
  complaint?: string;
  notes?: string;
};

/**
 * LLM layer — rewrites the placeholder question and complaint in an authentic driver's
 * voice for THIS specific car/track/symptom. Structure is never touched.
 */
export async function narrateScenario(
  scn: Scenario,
  opts: { provider: LlmProviderId; model: string }
): Promise<Scenario> {
  const shape = QUESTION_SHAPES[scn.axes?.questionShape ?? "pointed"];
  const focus = scn.world.runs[scn.world.focusRunIndex];
  const system = [
    "You write dialogue for a 1/10 electric touring car (RC) racing app.",
    "You are given a real race situation. Write how the DRIVER would actually talk — terse, first person, club-racer vocabulary.",
    "Never invent setup numbers, lap times or technical data; only write the human words.",
    "Never mention AI, modes, or the app itself.",
    'Return ONLY JSON: {"question": "...", "complaint": "...", "notes": "..."}',
    "`question` = what the driver types to their race engineer. `complaint` = a short handling-problem note (max 12 words). `notes` = optional one-line run note, may be empty.",
  ].join("\n");

  const user = JSON.stringify({
    car: scn.world.car.name,
    track: scn.world.track.name,
    grip: scn.axes?.gripLevel,
    runsLogged: scn.world.runs.length,
    historyDepth: scn.axes?.historyDepth,
    symptom: scn.axes?.problemType,
    dataConflict: scn.axes?.dataConflict ?? "none",
    focusRunLaps: focus?.lapTimes?.length ?? 0,
    hasLapTimes: (focus?.lapTimes?.length ?? 0) > 0,
    questionShape: shape.id,
    questionGuidance: shape.guidance,
    exampleWording: shape.fallback,
  });

  const res = await llmChat({
    provider: opts.provider,
    model: opts.model,
    temperature: 0.9, // variety across hundreds of scenarios
    responseFormatJson: true,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const parsed = parseJsonLoose<NarrationResult>(res.content);
  if (!parsed?.question?.trim()) return scn; // keep the deterministic fallback

  const runs = scn.world.runs.map((r, i) => {
    if (i !== scn.world.focusRunIndex) return r;
    const next: ScenarioRun = { ...r };
    // Only write text the archetype would actually have logged.
    if (r.handlingProblems != null && parsed.complaint?.trim()) {
      next.handlingProblems = parsed.complaint.trim();
    }
    if (r.notes !== null && parsed.notes?.trim()) next.notes = parsed.notes.trim();
    return next;
  });

  return {
    ...scn,
    question: parsed.question.trim(),
    world: { ...scn.world, runs },
  };
}
