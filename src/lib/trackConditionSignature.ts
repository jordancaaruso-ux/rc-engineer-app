import { normalizeGripTags, normalizeLayoutTags } from "@/lib/trackMetaTags";

/**
 * Stable bucket id for aggregating runs by track grip + layout tags (canonical order),
 * optionally refined by an air-temperature band.
 *
 * Base:            `g:LOW+MEDIUM_l:TECHNICAL`  (or `g:none_l:none` when untagged)
 * With temp band:  `g:LOW+MEDIUM_l:TECHNICAL_t:warm`
 *
 * The `_t:` suffix is only appended when a band is supplied, so the base form is
 * byte-identical to the legacy signature — existing aggregation rows and lookups
 * that don't care about temperature keep working unchanged. The rebuild emits
 * both the base bucket and (when a run has a temperature) the temp-specific
 * bucket, and reads prefer the temp-specific bucket with a fallback to base.
 */
export function encodeTrackConditionSignature(
  gripTags: readonly string[] | null | undefined,
  layoutTags: readonly string[] | null | undefined,
  temperatureBand?: string | null
): string {
  const g = normalizeGripTags(gripTags ?? []).join("+");
  const l = normalizeLayoutTags(layoutTags ?? []).join("+");
  const base = `g:${g || "none"}_l:${l || "none"}`;
  return temperatureBand ? `${base}_t:${temperatureBand}` : base;
}

/** Append a temperature band to an already-encoded base signature (no-op when band is empty). */
export function withTemperatureBand(
  baseSignature: string,
  temperatureBand: string | null | undefined
): string {
  return temperatureBand ? `${baseSignature}_t:${temperatureBand}` : baseSignature;
}
