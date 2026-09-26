/**
 * Stored on `Track.gripTags` / `Track.layoutTags`, arrays in canonical order.
 *
 * One value each (founder call 2026-09-26): the chips read as a single scale from "Very low" to
 * "Very high", and as a pick-several list a driver fixing a wrong tag saved two contradictory ones
 * ("Very low · High"). Tapping a value replaces the old one (`pickOneTag`). The columns stay
 * arrays, so a track saved with two before then keeps both until someone taps one.
 */

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

/**
 * The tags after tapping `id` on a one-value scale: that value alone, or none when it was
 * already the only one (a tap on the lit chip clears it). A track still holding two from before
 * keeps just the tapped one.
 */
export function pickOneTag<T extends string>(current: readonly string[], id: T): T[] {
  return current.length === 1 && current[0] === id ? [] : [id];
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
