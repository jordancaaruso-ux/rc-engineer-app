import type {
  PaceVsFieldRunDigestRowV1,
  PaceVsFieldRunDigestSubsetV1,
  PaceVsFieldRunDigestV1,
} from "./paceVsFieldRunDigestTypes";
import { PACE_VS_FIELD_DIGEST_SUBSET_MAX_ROWS } from "./paceVsFieldRunDigestTypes";

export function isValidDigestRowShape(row: unknown): row is PaceVsFieldRunDigestRowV1 {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  if (typeof r.runId !== "string" || !r.runId.trim()) return false;
  if (typeof r.sortIso !== "string" || !r.sortIso.trim()) return false;
  if (typeof r.gapUserMinusFieldMeanSeconds !== "number" || !Number.isFinite(r.gapUserMinusFieldMeanSeconds)) {
    return false;
  }
  if (typeof r.avgTop10UserSeconds !== "number" || !Number.isFinite(r.avgTop10UserSeconds)) return false;
  if (typeof r.avgTop10FieldMeanSeconds !== "number" || !Number.isFinite(r.avgTop10FieldMeanSeconds)) return false;
  if (typeof r.sessionDriverCount !== "number" || !Number.isFinite(r.sessionDriverCount)) return false;
  return true;
}

/** Accept client-reattached digest in chat POST (same shape as GET). */
export function parsePaceVsFieldRunDigestPayload(raw: unknown): PaceVsFieldRunDigestV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return null;
  if (!Array.isArray(o.rows)) return null;
  for (const row of o.rows) {
    if (!row || typeof row !== "object") return null;
    const r = row as Record<string, unknown>;
    if (typeof r.runId !== "string" || !r.runId.trim()) return null;
    if (typeof r.gapUserMinusFieldMeanSeconds !== "number" || !Number.isFinite(r.gapUserMinusFieldMeanSeconds)) {
      return null;
    }
    if (!isValidDigestRowShape(row)) return null;
  }
  return raw as PaceVsFieldRunDigestV1;
}

/** Accept client-built subset in chat POST. */
export function parsePaceVsFieldRunDigestSubsetPayload(raw: unknown): PaceVsFieldRunDigestSubsetV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return null;
  if (typeof o.parentDigestGeneratedAtIso !== "string" || !o.parentDigestGeneratedAtIso.trim()) return null;
  if (typeof o.generatedAtIso !== "string" || !o.generatedAtIso.trim()) return null;
  if (typeof o.filterSummary !== "string" || !o.filterSummary.trim()) return null;
  if (o.metric !== "avg_top_10_vs_field_mean") return null;
  if (o.gapMeaning !== "user_seconds_minus_field_mean_positive_slower") return null;
  if (!Array.isArray(o.rows) || o.rows.length === 0 || o.rows.length > PACE_VS_FIELD_DIGEST_SUBSET_MAX_ROWS) {
    return null;
  }
  for (const row of o.rows) {
    if (!isValidDigestRowShape(row)) return null;
  }
  return raw as PaceVsFieldRunDigestSubsetV1;
}
