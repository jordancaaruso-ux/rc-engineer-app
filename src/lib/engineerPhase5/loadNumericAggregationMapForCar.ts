import { prisma } from "@/lib/prisma";
import { SetupAggregationScopeType } from "@prisma/client";
import {
  parseNumericAggregationCompareSlice,
  type NumericAggregationCompareSlice,
} from "@/lib/setupCompare/numericAggregationCompare";

/** Car-level numeric aggregation slices for setup compare (IQR-scaled severity). */
export async function loadNumericAggregationMapForCar(
  carId: string
): Promise<Map<string, NumericAggregationCompareSlice>> {
  const rows = await prisma.setupParameterAggregation.findMany({
    where: { carId, scopeType: SetupAggregationScopeType.CAR_PARAMETER },
    select: { parameterKey: true, numericStatsJson: true },
  });
  const map = new Map<string, NumericAggregationCompareSlice>();
  for (const r of rows) {
    const slice = parseNumericAggregationCompareSlice(r.numericStatsJson);
    if (slice) map.set(r.parameterKey, slice);
  }
  return map;
}
