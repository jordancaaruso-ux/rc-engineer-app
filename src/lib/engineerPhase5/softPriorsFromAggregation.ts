import { prisma } from "@/lib/prisma";
import { SetupAggregationScopeType } from "@prisma/client";
import type { NumericStats } from "@/lib/setupAggregations/numericStats";
import type { EngineerSetupChangeRow } from "@/lib/engineerPhase5/engineerRunSummaryTypes";

const MIN_SAMPLES = 5;
const IQR_MULT = 2;

function readNumericStats(json: unknown): NumericStats | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const sampleCount = Number(o.sampleCount);
  const iqr = Number(o.iqr);
  if (!Number.isFinite(sampleCount) || sampleCount < MIN_SAMPLES) return null;
  if (!Number.isFinite(iqr) || iqr <= 0) return null;
  return o as unknown as NumericStats;
}

/**
 * Soft, user-dismissible lines: compare |Δ| on numeric fields to historical IQR (Phase 4).
 */
export async function softPriorsForSetupChanges(
  carId: string | null,
  setupChanges: EngineerSetupChangeRow[]
): Promise<string[]> {
  if (!carId || setupChanges.length === 0) return [];

  const keys = [...new Set(setupChanges.map((r) => r.key))];
  const rows = await prisma.setupParameterAggregation.findMany({
    where: {
      scopeType: SetupAggregationScopeType.CAR_PARAMETER,
      carId,
      parameterKey: { in: keys },
    },
    select: { parameterKey: true, numericStatsJson: true, sampleCount: true },
  });

  const byKey = new Map(rows.map((r) => [r.parameterKey, r]));
  const out: string[] = [];

  for (const ch of setupChanges.slice(0, 5)) {
    const row = byKey.get(ch.key);
    if (!row?.numericStatsJson) continue;
    const stats = readNumericStats(row.numericStatsJson);
    if (!stats) continue;

    const a = parseFloat(String(ch.after).replace(/[^\d.-]/g, ""));
    const b = parseFloat(String(ch.before).replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const deltaAbs = Math.abs(a - b);
    const threshold = stats.iqr * IQR_MULT;
    if (!(threshold > 0) || deltaAbs <= threshold) continue;

    out.push(
      `${ch.label}: this adjustment is larger than typical spread for your saved setups on this car (${stats.sampleCount} samples; rule of thumb ×${IQR_MULT} IQR).`
    );
  }

  return out;
}
