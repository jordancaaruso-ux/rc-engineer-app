/**
 * Tire-prep sequence — the ordered applications a driver runs before a session.
 *
 * A run carries ONE additive (see `additiveTypeId`) plus an ordered list of prep
 * **steps** toward the run. Each step is a timed application that is either on the
 * bench or in the warmers; a step may apply the additive again or be heat-only
 * (`appliedAdditive: false`). Warmer-only detail (towels + temperature) is captured
 * per step and only meaningful when `warmers` is true.
 *
 *   carpet:   bench 20m + bench 15m + bench 10m   (×3, no warmers)
 *   outdoor:  bench 20m + warmers 10m @ 55°C (towels)
 *
 * Stored as JSON on `Run.tirePrep`. The legacy single `Run.warmerTimingMinutes`
 * Int is kept in sync as a derived total (sum of warmer-step minutes) so older read
 * surfaces and aggregations keep working; `tirePrep` is the source of truth.
 */

export type TirePrepStep = {
  /** Was the run's additive (re)applied on this step? false = heat-only. */
  appliedAdditive: boolean;
  /** Duration of this step, in minutes. Null = not recorded. */
  minutes: number | null;
  /** true = in the warmers; false = on the bench / open air. */
  warmers: boolean;
  /** Towel between warmer cup and tire. Only meaningful when `warmers`. */
  towels: boolean;
  /** Warmer temperature in °C. Optional; only meaningful when `warmers`. */
  temperatureC: number | null;
};

export const MAX_TIRE_PREP_STEPS = 3;

/** Wheel markers for the per-step minute picker (fine low, coarse high). Any exact minute is allowed. */
export const TIRE_PREP_MINUTE_MARKERS = [5, 10, 15, 20, 30, 40, 50, 60] as const;

/** Warmer temperature wheel bounds (°C), optional. */
export const TIRE_PREP_TEMP_MIN_C = 40;
export const TIRE_PREP_TEMP_MAX_C = 100;

/**
 * Default values that pre-fill a newly added application so its boxes are never
 * blank (founder decision 2026-07-15: a shown default IS the logged value). These
 * apply only when the driver explicitly adds an application — the section starts
 * empty, so ignoring tire prep still saves nothing.
 */
export const TIRE_PREP_DEFAULT_MINUTES = 20;
export const TIRE_PREP_DEFAULT_TEMP_C = 70;

const MINUTES_HARD_MAX = 600;
const TEMP_HARD_MAX = 250;

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

function coerceMinutes(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  return clampInt(n, 0, MINUTES_HARD_MAX);
}

function coerceTemp(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  return clampInt(n, 0, TEMP_HARD_MAX);
}

export function emptyTirePrepStep(): TirePrepStep {
  return { appliedAdditive: true, minutes: null, warmers: false, towels: false, temperatureC: null };
}

/**
 * A freshly added application, pre-filled with the logged-by-default values.
 * Carries the previous step's on/off choices forward (bench vs warmers, towels,
 * additive) for fast repeat prep, but resets the numeric boxes to the fixed
 * defaults so they read a value immediately (`—` is never shown on add).
 */
export function newTirePrepStep(prev?: TirePrepStep): TirePrepStep {
  const warmers = prev ? prev.warmers : false;
  return {
    appliedAdditive: prev ? prev.appliedAdditive : true,
    minutes: TIRE_PREP_DEFAULT_MINUTES,
    warmers,
    towels: warmers ? Boolean(prev?.towels) : false,
    temperatureC: warmers ? TIRE_PREP_DEFAULT_TEMP_C : null,
  };
}

function normalizeTirePrepStep(raw: unknown): TirePrepStep | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const warmers = Boolean(r.warmers);
  return {
    appliedAdditive: r.appliedAdditive == null ? true : Boolean(r.appliedAdditive),
    minutes: coerceMinutes(r.minutes),
    warmers,
    // Towels / temperature only carry meaning in the warmers.
    towels: warmers ? Boolean(r.towels) : false,
    temperatureC: warmers ? coerceTemp(r.temperatureC) : null,
  };
}

/** Coerce arbitrary JSON (DB row or request body) into a clean, capped step list. */
export function normalizeTirePrep(raw: unknown): TirePrepStep[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeTirePrepStep)
    .filter((s): s is TirePrepStep => s != null)
    .slice(0, MAX_TIRE_PREP_STEPS);
}

/** A step counts as "empty" (nothing worth saving) when it records no time and no warmer use. */
function stepHasContent(s: TirePrepStep): boolean {
  return (s.minutes != null && s.minutes > 0) || s.warmers;
}

export function tirePrepHasContent(steps: TirePrepStep[]): boolean {
  return steps.some(stepHasContent);
}

/** Drop trailing/blank steps before persisting so an untouched "Add step" row isn't saved. */
export function pruneTirePrepForSave(steps: TirePrepStep[]): TirePrepStep[] {
  return steps.filter(stepHasContent).slice(0, MAX_TIRE_PREP_STEPS);
}

/**
 * Back-compat: synthesize a single step from the legacy `warmerTimingMinutes`
 * Int so runs logged before the sequence model still populate the builder.
 * Legacy semantics were "warmer timing", so the synthesized step is in the warmers.
 */
export function tirePrepFromLegacy(
  warmerTimingMinutes: number | null | undefined,
  hasAdditive: boolean
): TirePrepStep[] {
  if (warmerTimingMinutes == null || !Number.isFinite(warmerTimingMinutes)) return [];
  const minutes = clampInt(warmerTimingMinutes, 0, MINUTES_HARD_MAX);
  if (minutes <= 0) return [];
  return [
    { appliedAdditive: hasAdditive, minutes, warmers: true, towels: false, temperatureC: null },
  ];
}

/**
 * Derived legacy value written back to `Run.warmerTimingMinutes`: total minutes
 * spent in the warmers across the sequence. Null when no step used warmers.
 */
export function derivedWarmerTimingMinutes(steps: TirePrepStep[]): number | null {
  let total = 0;
  let any = false;
  for (const s of steps) {
    if (s.warmers && s.minutes != null && s.minutes > 0) {
      total += s.minutes;
      any = true;
    }
  }
  return any ? total : null;
}

function formatStep(s: TirePrepStep): string {
  const where = s.warmers ? "warmers" : "bench";
  const mins = s.minutes != null && s.minutes > 0 ? `${s.minutes}m ` : "";
  let out = `${mins}${where}`.trim();
  if (s.warmers && s.temperatureC != null) out += ` ${s.temperatureC}°C`;
  if (s.warmers && s.towels) out += " (towels)";
  if (!s.appliedAdditive) out += " · no sauce";
  return out;
}

/**
 * Human-readable one-liner for read surfaces (run detail, compare, Engineer):
 *   "VP · 20m bench + 10m warmers 55°C (towels)"
 * Returns null when there is nothing to show.
 */
export function formatTirePrepLine(
  steps: TirePrepStep[],
  additiveDisplayName?: string | null
): string | null {
  const content = steps.filter(stepHasContent);
  const seq = content.map(formatStep).join(" + ");
  const additive = additiveDisplayName?.trim();
  if (!seq && !additive) return null;
  if (!seq) return additive ?? null;
  return additive ? `${additive} · ${seq}` : seq;
}
