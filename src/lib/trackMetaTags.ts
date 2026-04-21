/** Stored on `Track.gripTags` / `Track.layoutTags` (multi-select, canonical order). */

export const TRACK_GRIP_TAG_IDS = [
  "VERY_LOW",
  "LOW",
  "MEDIUM",
  "HIGH",
  "VERY_HIGH",
] as const;

export type TrackGripTagId = (typeof TRACK_GRIP_TAG_IDS)[number];

export const TRACK_LAYOUT_TAG_IDS = [
  "VERY_TECHNICAL",
  "TECHNICAL",
  "MEDIUM",
  "FAST",
  "VERY_FAST",
] as const;

export type TrackLayoutTagId = (typeof TRACK_LAYOUT_TAG_IDS)[number];

export const TRACK_GRIP_LABELS: Record<TrackGripTagId, string> = {
  VERY_LOW: "Very low",
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  VERY_HIGH: "Very high",
};

export const TRACK_LAYOUT_LABELS: Record<TrackLayoutTagId, string> = {
  VERY_TECHNICAL: "Very technical",
  TECHNICAL: "Technical",
  MEDIUM: "Medium",
  FAST: "Fast",
  VERY_FAST: "Very fast",
};

const GRIP_SET = new Set<string>(TRACK_GRIP_TAG_IDS);
const LAYOUT_SET = new Set<string>(TRACK_LAYOUT_TAG_IDS);

export function normalizeGripTags(raw: unknown): TrackGripTagId[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set(raw.filter((x): x is string => typeof x === "string" && GRIP_SET.has(x)));
  return TRACK_GRIP_TAG_IDS.filter((id) => set.has(id));
}

export function normalizeLayoutTags(raw: unknown): TrackLayoutTagId[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set(raw.filter((x): x is string => typeof x === "string" && LAYOUT_SET.has(x)));
  return TRACK_LAYOUT_TAG_IDS.filter((id) => set.has(id));
}

export function formatGripTagsForDisplay(tags: readonly string[]): string {
  const n = normalizeGripTags(tags);
  if (n.length === 0) return "—";
  return n.map((id) => TRACK_GRIP_LABELS[id as TrackGripTagId] ?? id).join(" · ");
}

export function formatLayoutTagsForDisplay(tags: readonly string[]): string {
  const n = normalizeLayoutTags(tags);
  if (n.length === 0) return "—";
  return n.map((id) => TRACK_LAYOUT_LABELS[id as TrackLayoutTagId] ?? id).join(" · ");
}
