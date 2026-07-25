/**
 * User archetypes — how much context a real user actually fills in.
 *
 * Field completeness is CORRELATED, not random: someone who fills the handling chips also
 * writes notes and rates the car; a minimalist skips all of it. Independent per-field
 * dropout would manufacture bundles no real user produces (detailed chips but no rating),
 * so flaws found there wouldn't matter. Jordan's steer: even spread across all five, with
 * structured handling and tire detail as the most-skipped fields.
 *
 * Note the proactive surfaces (dashboard suggestion, between-run hints) fire at minimalist
 * users too — so thin bundles matter even though a minimalist may never type a question.
 */
import type { ArchetypeId, HandlingRichness, ScenarioRun } from "./types";

export type ArchetypeSpec = {
  id: ArchetypeId;
  label: string;
  /** Structured chips vs free text vs nothing. */
  handlingRichness: HandlingRichness;
  hasLapTimes: boolean;
  hasCarRating: boolean;
  hasNotes: boolean;
  /** Tire set + run number + prep sequence tracked. */
  hasTireDetail: boolean;
  /** Full resolved setup sheet vs a handful of keys. */
  setupCompleteness: "full" | "partial";
  sessionType: "TESTING" | "PRACTICE" | "RACE_MEETING";
};

export const ARCHETYPES: Record<ArchetypeId, ArchetypeSpec> = {
  minimalist: {
    id: "minimalist",
    label: "Minimalist — logs the run, fills nothing",
    handlingRichness: "none",
    hasLapTimes: true,
    hasCarRating: false,
    hasNotes: false,
    hasTireDetail: false,
    setupCompleteness: "partial",
    sessionType: "TESTING",
  },
  typical: {
    id: "typical",
    label: "Typical — laps, rating, a one-line complaint",
    handlingRichness: "free-text",
    hasLapTimes: true,
    hasCarRating: true,
    hasNotes: true,
    hasTireDetail: false,
    setupCompleteness: "full",
    sessionType: "TESTING",
  },
  completionist: {
    id: "completionist",
    label: "Completionist — fills everything",
    handlingRichness: "full",
    hasLapTimes: true,
    hasCarRating: true,
    hasNotes: true,
    hasTireDetail: true,
    setupCompleteness: "full",
    sessionType: "PRACTICE",
  },
  "no-timing": {
    id: "no-timing",
    label: "No-timing — club practice, no transponder",
    handlingRichness: "free-text",
    hasLapTimes: false,
    hasCarRating: true,
    hasNotes: true,
    hasTireDetail: false,
    setupCompleteness: "full",
    sessionType: "PRACTICE",
  },
  "race-weekend": {
    id: "race-weekend",
    label: "Race weekend — rushed between sessions, high stakes",
    handlingRichness: "none",
    hasLapTimes: true,
    hasCarRating: true,
    hasNotes: false,
    hasTireDetail: true,
    setupCompleteness: "full",
    sessionType: "RACE_MEETING",
  },
};

export const ARCHETYPE_IDS = Object.keys(ARCHETYPES) as ArchetypeId[];

/**
 * Strip a fully-populated run down to what this archetype would actually have logged.
 * Mutates nothing — returns a new run.
 */
export function applyArchetype(run: ScenarioRun, spec: ArchetypeSpec): ScenarioRun {
  const out: ScenarioRun = { ...run };

  if (!spec.hasLapTimes) {
    out.lapTimes = [];
    out.lapSession = undefined;
    out.bestLapSeconds = null;
    out.avgTop5LapSeconds = null;
  }
  if (!spec.hasCarRating) out.carRating = null;
  if (!spec.hasNotes) {
    out.notes = null;
    out.driverNotes = null;
  }
  if (spec.handlingRichness === "none") {
    out.handlingAssessmentJson = undefined;
    // A minimalist may still type a few words, but often nothing at all.
    out.handlingProblems = null;
  } else if (spec.handlingRichness === "free-text") {
    // Free-text complaint only — the structured chips are the most-skipped field.
    out.handlingAssessmentJson = undefined;
  }
  if (!spec.hasTireDetail) {
    // Tire set stays attached (it's carried forward), but the run count is unreliable
    // and no prep sequence was recorded.
    out.tireRunNumber = undefined;
  }
  out.sessionType = spec.sessionType;
  if (spec.sessionType === "RACE_MEETING") {
    out.meetingSessionType = out.meetingSessionType ?? "QUALIFYING";
    out.meetingSessionCode = out.meetingSessionCode ?? "Q2";
  }
  return out;
}

/** Keys kept when an archetype logs only a partial setup sheet (no OCR'd full sheet). */
const PARTIAL_SETUP_KEYS = [
  "camber_front",
  "camber_rear",
  "toe_front",
  "toe_rear",
  "ride_height_front",
  "ride_height_rear",
  "spring_front",
  "spring_rear",
  "damper_oil_front",
  "damper_oil_rear",
  "diff_oil",
  "motor",
  "pinion",
  "spur",
];

/** Reduce a full setup blob to the handful of keys a sparse user would have. */
export function thinSetupData(
  data: Record<string, unknown>,
  completeness: ArchetypeSpec["setupCompleteness"]
): Record<string, unknown> {
  if (completeness === "full") return { ...data };
  const out: Record<string, unknown> = {};
  for (const k of PARTIAL_SETUP_KEYS) {
    if (k in data) out[k] = data[k];
  }
  // If the real seed used different key names, keep a small slice rather than nothing.
  if (Object.keys(out).length === 0) {
    for (const k of Object.keys(data).slice(0, 10)) out[k] = data[k];
  }
  return out;
}
