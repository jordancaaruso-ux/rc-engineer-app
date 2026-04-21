import { normalizeGripTags, normalizeLayoutTags } from "@/lib/trackMetaTags";

/**
 * Stable bucket id for aggregating runs by track grip + layout tags (canonical order).
 * Example: `g:LOW+MEDIUM_l:TECHNICAL` or `g:none_l:none` when untagged.
 */
export function encodeTrackConditionSignature(
  gripTags: readonly string[] | null | undefined,
  layoutTags: readonly string[] | null | undefined
): string {
  const g = normalizeGripTags(gripTags ?? []).join("+");
  const l = normalizeLayoutTags(layoutTags ?? []).join("+");
  return `g:${g || "none"}_l:${l || "none"}`;
}
