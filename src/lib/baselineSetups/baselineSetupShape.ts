/**
 * Shape and validation for global baseline setups — pure, no Prisma, no server imports, so the
 * admin form, the API route and the tests all agree on one definition of a valid row.
 *
 * A baseline is an *authored* sheet published against a chassis type, not measured data. That
 * distinction is why `kind` exists and why it is required reading for anything downstream:
 * the Engineer treats these as reference points, never as a sample of what drivers run.
 */

/** Widen this when a new kind is added; the API rejects anything outside it. */
export const BASELINE_SETUP_KINDS = ["KIT", "BASE", "PRO"] as const;
export type BaselineSetupKindValue = (typeof BASELINE_SETUP_KINDS)[number];

export const BASELINE_KIND_LABEL: Record<BaselineSetupKindValue, string> = {
  KIT: "Kit",
  BASE: "Base",
  PRO: "Pro",
};

/** One line each, shown under the kind picker so the admin files a sheet in the right place. */
export const BASELINE_KIND_HINT: Record<BaselineSetupKindValue, string> = {
  KIT: "How the manufacturer says to build the car out of the box.",
  BASE: "A manufacturer-released base sheet, usually written by one of their drivers.",
  PRO: "Any other setup worth publishing — a team car, an event-winning sheet.",
};

/**
 * Display order: kit first (it is the neutral reference every driver wants), then base, then the
 * long tail of pro sheets. Within a kind, newest first — the caller supplies that.
 */
const KIND_ORDER: Record<BaselineSetupKindValue, number> = { KIT: 0, BASE: 1, PRO: 2 };

/** Same vocabulary as the community aggregation buckets, so tags stay comparable later. */
export const BASELINE_SURFACES = ["asphalt", "carpet"] as const;
export const BASELINE_GRIP_LEVELS = ["low", "medium", "high"] as const;

export const MAX_BASELINE_NAME_LENGTH = 80;
export const MAX_BASELINE_NOTES_LENGTH = 600;

export function parseBaselineKind(raw: unknown): BaselineSetupKindValue | null {
  return typeof raw === "string" && (BASELINE_SETUP_KINDS as readonly string[]).includes(raw)
    ? (raw as BaselineSetupKindValue)
    : null;
}

/** Optional tags: an empty or unknown value clears the tag rather than failing the save. */
export function parseBaselineSurface(raw: unknown): string | null {
  return typeof raw === "string" && (BASELINE_SURFACES as readonly string[]).includes(raw)
    ? raw
    : null;
}

export function parseBaselineGripLevel(raw: unknown): string | null {
  return typeof raw === "string" && (BASELINE_GRIP_LEVELS as readonly string[]).includes(raw)
    ? raw
    : null;
}

export function cleanBaselineName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_BASELINE_NAME_LENGTH);
}

export function cleanBaselineNotes(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_BASELINE_NOTES_LENGTH);
}

/**
 * "Carpet · high grip", or null when neither tag is set. Tags are optional metadata for the driver
 * reading the list — nothing keys off them yet.
 */
export function baselineContextLabel(row: {
  surface: string | null;
  gripLevel: string | null;
}): string | null {
  const parts = [
    row.surface ? row.surface[0].toUpperCase() + row.surface.slice(1) : null,
    row.gripLevel ? `${row.gripLevel} grip` : null,
  ].filter((p): p is string => p != null);
  return parts.length ? parts.join(" · ") : null;
}

/** Kit, then base, then pro; ties keep the order the caller passed (newest first from the query). */
export function sortBaselineSetups<T extends { kind: BaselineSetupKindValue }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}
