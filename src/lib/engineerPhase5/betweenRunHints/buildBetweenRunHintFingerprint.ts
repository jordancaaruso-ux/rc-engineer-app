import { createHash } from "node:crypto";
import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import type { RecentSessionsFingerprintMaterial } from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintTypes";

function stableReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as object)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = (value as Record<string, unknown>)[k];
        return acc;
      }, {});
  }
  return value;
}

/**
 * Hash inputs that should invalidate cached hints when the observable run pair changes.
 */
export function buildBetweenRunHintFingerprint(params: {
  summary: EngineerRunSummaryV2;
  handlingAssessmentJson: unknown;
  /** When omitted, fingerprint matches legacy hints (pre multi-run panel). */
  recentSessionsMaterial?: RecentSessionsFingerprintMaterial | null;
}): string {
  const sc = params.summary.setupChanges.map((r) => ({
    k: r.key,
    before: r.before,
    after: r.after,
  }));
  const payload = {
    v: 3 as const,
    refId: params.summary.referenceRunId,
    fieldFp: params.summary.fieldFingerprint,
    lap: {
      best: params.summary.lapOutcome.best,
      avgTop5: params.summary.lapOutcome.avgTop5,
    },
    setup: sc,
    interpretation: params.summary.interpretation,
    handling: params.handlingAssessmentJson ?? null,
    recent: params.recentSessionsMaterial ?? null,
  };
  const json = JSON.stringify(payload, stableReplacer);
  return createHash("sha256").update(json, "utf8").digest("hex");
}
