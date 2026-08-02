/**
 * Pure anonymization helpers for the demo seed (`scripts/seed-demo-account.ts`) — NO
 * database, NO Next imports. Unit-tested via `npm run test:demo`.
 *
 * Two jobs, in order of application:
 *   1. scrub — real people's names → demo names (word-boundary, case-insensitive) and
 *      transponder-length digit runs masked in free-text fields.
 *   2. overlay — founder-authored rewrites win over everything (curation, decision-board:
 *      "reword notes a little and add handling details").
 */

export type NameScrubPair = { from: string; to: string };

export type Scrubber = (text: string) => string;

/** Compile the name table once; longer names first so "Jordan Caruso" wins over "Jordan". */
export function buildScrubber(pairs: NameScrubPair[], opts?: { transponders?: boolean }): Scrubber {
  const compiled = [...pairs]
    .filter((p) => p.from.trim().length > 0)
    .sort((a, b) => b.from.length - a.from.length)
    .map((p) => ({
      re: new RegExp(`\\b${p.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"),
      to: p.to,
    }));
  const scrubTransponders = opts?.transponders !== false;
  return (text: string) => {
    let out = text;
    for (const { re, to } of compiled) out = out.replace(re, to);
    // Transponder numbers are 7+ digit runs; race times/temps never are.
    if (scrubTransponders) out = out.replace(/\b\d{7,}\b/g, "0000000");
    return out;
  };
}

/** Scrub every string inside a JSON-ish value (lap-session payloads, handling JSON, chat metadata). */
export function deepScrub<T>(value: T, scrub: Scrubber): T {
  if (typeof value === "string") return scrub(value) as unknown as T;
  if (value instanceof Date) return value; // row objects carry Dates — never walk them
  if (Array.isArray(value)) return value.map((v) => deepScrub(v, scrub)) as unknown as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepScrub(v, scrub);
    }
    return out as unknown as T;
  }
  return value;
}

/** Founder's per-run curation — applied AFTER scrubbing so curated text always wins. */
export type RunOverlay = {
  /** Replaces Run.notes when present (empty string clears it). */
  notes?: string;
  /** Replaces Run.driverNotes when present. */
  driverNotes?: string;
};

export type CurationOverlay = {
  /** Keyed by ORIGINAL (source) run id — the ids the founder sees in his own app. */
  runs?: Record<string, RunOverlay>;
  /** Original EngineerChatThread ids to include as the demo's curated history. */
  includeThreadIds?: string[];
  /** Extra name-scrub pairs beyond the defaults (mates named in notes). */
  nameScrub?: NameScrubPair[];
};

export function applyRunOverlay<T extends { notes: string | null; driverNotes: string | null }>(
  run: T,
  overlay: RunOverlay | undefined,
): T {
  if (!overlay) return run;
  return {
    ...run,
    notes: overlay.notes !== undefined ? overlay.notes || null : run.notes,
    driverNotes: overlay.driverNotes !== undefined ? overlay.driverNotes || null : run.driverNotes,
  };
}
