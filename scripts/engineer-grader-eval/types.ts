/**
 * Shared shapes for the offline grader-eval harness.
 *
 * A Scenario is a self-contained, internally-consistent "world" (a synthetic user's
 * car + track + tire set + a chain of logged runs) plus the engineer question anchored
 * on one focus run. seedBranch.ts materializes `world` into real DB rows on a throwaway
 * branch so the live answer path + its userId-scoped tools run unmodified. Each scenario
 * owns its own synthetic user, so `search_runs` / `tire_history_at_track` (which filter
 * by userId) see only this scenario's history — no cross-bleed.
 *
 * Field names track prisma/schema.prisma (Run / SetupSnapshot / TireSet …). `setupData`,
 * `lapSession`, and `handlingAssessmentJson` are pass-through JSON blobs sourced from real
 * runs — the factory perturbs known keys but never invents the blob wholesale.
 */

/**
 * Chat mode. The flaw-hunt corpus always uses "normal": Jordan doubts the quick/deep
 * feature ("I think it'll cause confusing"), so urgency lives in the QUESTION'S WORDS
 * and whether the engine infers trackside-vs-debrief on its own is a hunted finding.
 */
export type ScenarioMode = "quick" | "normal" | "deep";

/** Which user fills context how — completeness is correlated, not random. */
export type ArchetypeId = "minimalist" | "typical" | "completionist" | "no-timing" | "race-weekend";

export type HistoryDepth = "single-run" | "single-day" | "season";

/** Structured handling chips are the most-skipped field — corpus skews sparse. */
export type HandlingRichness = "none" | "free-text" | "full";

/**
 * Whether the setup sheet keeps up with reality. "stale" is the silent killer: the car
 * changed but the sheet didn't, so the setup diff comes back EMPTY between two runs that
 * genuinely differ — the engine reasons as if nothing changed. Jordan doesn't know how
 * common this is in practice, so the corpus generates all three and lets the flaw map say.
 */
export type SetupFreshness = "fresh" | "stale" | "partial";

export type QuestionShapeId =
  | "vague"
  | "pointed"
  | "trackside-urgent"
  | "debrief"
  | "demanding"
  | "challenging"
  | "teaching"
  | "laundry-bait"
  | "no-change-bait"
  | "off-piste";

export type ProblemTypeId =
  | "entry-understeer"
  | "mid-understeer"
  | "exit-oversteer"
  | "on-power-snap"
  | "traction-roll"
  | "braking-loose"
  | "darty"
  | "inconsistent"
  | "tires-going-off"
  | "nothing-wrong";

/**
 * One real setup sheet drawn from the AGGREGATION DATASET — the same pool that feeds
 * CommunitySetupParameterAggregation. Jordan's ~14 runs are one driver's taste on two
 * tracks; this pool is the full mix of chassis and tuning philosophies, so generated
 * scenarios start from genuinely varied real setups instead of variations on his own.
 */
export type SetupPoolEntry = {
  id: string;
  setupSheetTemplate: string | null;
  /** "asphalt" | "carpet" — the community bucket axis. */
  trackSurface?: string | null;
  data: Record<string, unknown>;
  source: "setup-document" | "run-snapshot";
  /** e.g. "petitrc" for publicly-published sheets vs a private user upload. */
  sourceSite?: string | null;
  keyCount: number;
};

/** The coverage grid, stamped on every scenario so the flaw map can group by axis. */
export type ScenarioAxes = {
  archetype: ArchetypeId;
  historyDepth: HistoryDepth;
  handlingRichness: HandlingRichness;
  setupFreshness: SetupFreshness;
  questionShape: QuestionShapeId;
  problemType: ProblemTypeId;
  /** e.g. "felt-worse-but-faster", "no-laps", "contradictory-notes". */
  dataConflict?: string | null;
  gripLevel?: string;
  /** Full setup-sheet template vs a sparse unknown chassis. */
  carFamiliarity: "template" | "sparse";
};

/** One logged run within a scenario's day. Array order = chronological (index 0 earliest). */
export type ScenarioRun = {
  /** Human label for provenance/debugging (e.g. "Run 3 — Q1"). */
  label?: string;
  /** Full resolved setup sheet → SetupSnapshot.data. */
  setupData: Record<string, unknown>;
  /** Primary lap times in seconds → Run.lapTimes. */
  lapTimes: number[];
  /** Structured multi-driver lap session → Run.lapSession (opaque; see lapSession/types.ts). */
  lapSession?: unknown;
  bestLapSeconds?: number | null;
  avgTop5LapSeconds?: number | null;
  /** Tire age within the set for this run → Run.tireRunNumber. */
  tireRunNumber?: number;
  /** Structured handling assessment → Run.handlingAssessmentJson (opaque; runHandlingAssessment). */
  handlingAssessmentJson?: unknown;
  /** Free-text driver complaint → Run.handlingProblems. */
  handlingProblems?: string | null;
  notes?: string | null;
  driverNotes?: string | null;
  /** 1–10 overall rating → Run.carRating. */
  carRating?: number | null;
  sessionType?: "TESTING" | "PRACTICE" | "RACE_MEETING";
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
  raceClass?: string | null;
  trackDirection?: "CW" | "CCW" | null;
  conditionsAirTempC?: number | null;
  conditionsTrackTempC?: number | null;
  conditionsHumidityPct?: number | null;
  conditionsCloudCoverPct?: number | null;
  conditionsWeatherCode?: number | null;
  conditionsWindKph?: number | null;
  conditionsSource?: string | null;
  /** Days before the focus run for sortAt ordering (focus run = 0). Larger = older. */
  sortAtOffsetDays?: number;
};

export type ScenarioWorld = {
  car: {
    name: string;
    chassis?: string | null;
    carClass?: string | null;
    setupSheetTemplate?: string | null;
    setupSheetModelId?: string | null;
  };
  track: {
    name: string;
    location?: string | null;
    gripTags?: string[];
    layoutTags?: string[];
  };
  trackLayout?: { name: string } | null;
  event?: { name: string; raceClass?: string | null } | null;
  tireSet?: {
    label: string;
    setNumber?: number;
    initialRunCount?: number;
    mark?: string | null;
    insertLabel?: string | null;
    tireType?: { displayName: string; modelCode: string } | null;
  } | null;
  additive?: { displayName: string; modelCode: string } | null;
  /** Chronological run chain; the focus run is usually the last. */
  runs: ScenarioRun[];
  /** Index into runs[] the question anchors on → the runId passed to runEngineerChatTurn. */
  focusRunIndex: number;
};

export type CoherenceVerdict = {
  verdict: "pass" | "fail" | "unchecked";
  reason?: string;
  /** e.g. "rules", "gpt-4o-mini", "grok-4.5". */
  checkedBy?: string;
};

export type Scenario = {
  id: string;
  version: 1;
  /** "seed" = snapshot of a real run (coherent by construction); "variation" = factory-perturbed. */
  source: "seed" | "variation";
  baseSeedId?: string;
  question: string;
  mode: ScenarioMode;
  world: ScenarioWorld;
  /** The coverage-grid cell this scenario occupies (variation only). */
  axes?: ScenarioAxes;
  /** Provenance of factory perturbations (variation only). */
  perturbation?: Array<{ op: string; params?: Record<string, unknown> }>;
  coherence?: CoherenceVerdict;
  /** Free tag used to stratify trust metrics (e.g. "close-call", "thin-context"). */
  difficultyTag?: string;
  /** Present only on planted-error pairs for the secondary catch-rate floor. */
  plantedError?: { kind: string; description: string } | null;
  tags?: string[];
};

/** What seedBranch.ts returns per scenario so the bench knows who/what to ask. */
export type SeededScenario = {
  scenarioId: string;
  userId: string;
  /** The focus run's DB id → runEngineerChatTurn({ runId }). */
  runId: string;
  question: string;
  mode: ScenarioMode;
};
