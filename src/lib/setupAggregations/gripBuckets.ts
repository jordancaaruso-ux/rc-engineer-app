/**
 * Grip-level bucket axis for community aggregations.
 *
 * The rebuild emits one aggregation row per `(setupSheetTemplate, trackSurface, gripLevel, parameterKey)`.
 * `gripLevel` is derived from the document's `traction` multi-select tag:
 *
 *   - `any`    - always emitted. Every eligible doc contributes here.
 *   - `low`    - docs tagged with `low` (alone or alongside others).
 *   - `medium` - docs tagged with `medium`.
 *   - `high`   - docs tagged with `high`.
 *
 * Multi-tag docs (e.g. `traction=["low","medium"]`) contribute to EVERY matching bucket plus `any`,
 * so the engineer's spread view sees them as examples for each grip class the setter marked.
 */
import { normalizeMultiSelectValue } from "@/lib/setup/multiSelect";
import type { SetupSnapshotValue } from "@/lib/runSetup";

export const GRIP_BUCKET_ANY = "any" as const;
export const GRIP_BUCKET_LOW = "low" as const;
export const GRIP_BUCKET_MEDIUM = "medium" as const;
export const GRIP_BUCKET_HIGH = "high" as const;

export type GripBucket =
  | typeof GRIP_BUCKET_ANY
  | typeof GRIP_BUCKET_LOW
  | typeof GRIP_BUCKET_MEDIUM
  | typeof GRIP_BUCKET_HIGH;

/** Iteration order is deterministic: any first, then low->medium->high. */
export const ALL_GRIP_BUCKETS: readonly GripBucket[] = [
  GRIP_BUCKET_ANY,
  GRIP_BUCKET_LOW,
  GRIP_BUCKET_MEDIUM,
  GRIP_BUCKET_HIGH,
] as const;

export const GRIP_BUCKETS_EXCLUDING_ANY: readonly GripBucket[] = [
  GRIP_BUCKET_LOW,
  GRIP_BUCKET_MEDIUM,
  GRIP_BUCKET_HIGH,
] as const;

const GRIP_LOOKUP: Record<string, GripBucket> = {
  low: GRIP_BUCKET_LOW,
  med: GRIP_BUCKET_MEDIUM,
  medium: GRIP_BUCKET_MEDIUM,
  high: GRIP_BUCKET_HIGH,
};

/** Parse a single textual tag into a canonical grip bucket, or null if unrecognized. */
export function canonicalGripBucket(raw: unknown): GripBucket | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  return GRIP_LOOKUP[t] ?? null;
}

/**
 * Buckets this document should contribute to. Always includes `any`; adds each
 * recognized token from `traction`. Deduplicated, stable order.
 */
export function gripBucketsForDoc(data: Record<string, SetupSnapshotValue>): GripBucket[] {
  const out = new Set<GripBucket>([GRIP_BUCKET_ANY]);
  const tokens = normalizeMultiSelectValue("traction", (data as Record<string, unknown>)["traction"]);
  for (const t of tokens) {
    const canon = canonicalGripBucket(t);
    if (canon) out.add(canon);
  }
  return ALL_GRIP_BUCKETS.filter((b) => out.has(b));
}

/**
 * Grip bucket to read for a given run. Returns `any` when no recognized token is present
 * OR when multiple recognized tokens are present (ambiguous — no single archetype fits).
 */
export function runReadGripBucket(data: Record<string, SetupSnapshotValue>): GripBucket {
  const tokens = normalizeMultiSelectValue("traction", (data as Record<string, unknown>)["traction"]);
  const canon = new Set<GripBucket>();
  for (const t of tokens) {
    const c = canonicalGripBucket(t);
    if (c) canon.add(c);
  }
  if (canon.size === 1) {
    const only = [...canon][0];
    if (only) return only;
  }
  return GRIP_BUCKET_ANY;
}

/** Pretty label for UI / engineer context. */
export function gripBucketLabel(b: GripBucket): string {
  switch (b) {
    case GRIP_BUCKET_LOW:
      return "low grip";
    case GRIP_BUCKET_MEDIUM:
      return "medium grip";
    case GRIP_BUCKET_HIGH:
      return "high grip";
    case GRIP_BUCKET_ANY:
    default:
      return "any grip";
  }
}
