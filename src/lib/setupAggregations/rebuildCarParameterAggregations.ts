import type { Prisma } from "@prisma/client";
import { SetupAggregationScopeType, SetupAggregationValueType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isMultiSelectFieldKey, normalizeMultiSelectValue } from "@/lib/setup/multiSelect";
import {
  displayPresetWithOther,
  isEmptyPresetWithOther,
  isPresetWithOtherFieldKey,
  normalizePresetWithOtherFromUnknown,
} from "@/lib/setup/presetWithOther";
import { getSingleSelectChipOptions } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import type { SetupSnapshotValue } from "@/lib/runSetup";
import {
  normalizeSetupSnapshotForStorage,
  snapshotValueIsEffectivelyEmpty,
} from "@/lib/runSetup";
import { computeNumericStats } from "@/lib/setupAggregations/numericStats";

/** At least this many non-empty parameter keys required on the snapshot to count toward aggregation. */
const MIN_DISTINCT_KEYS_FOR_ELIGIBILITY = 2;

function extractObservation(
  key: string,
  v: SetupSnapshotValue
):
  | { tag: "multi"; tokens: string[] }
  | { tag: "scalar"; nOrS: number | string }
  | null {
  if (snapshotValueIsEffectivelyEmpty(v)) return null;

  if (isMultiSelectFieldKey(key)) {
    const tokens = normalizeMultiSelectValue(key, v);
    if (tokens.length === 0) return null;
    return { tag: "multi", tokens };
  }

  if (typeof v === "number" && Number.isFinite(v)) {
    return { tag: "scalar", nOrS: v };
  }
  if (typeof v === "boolean") {
    return { tag: "scalar", nOrS: v ? "true" : "false" };
  }
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    if (Number.isFinite(n)) return { tag: "scalar", nOrS: n };
    return { tag: "scalar", nOrS: t };
  }
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const opts = isPresetWithOtherFieldKey(key) ? getSingleSelectChipOptions(key) : null;
    const pov = normalizePresetWithOtherFromUnknown(v, undefined, opts);
    if (!isEmptyPresetWithOther(pov)) {
      return { tag: "scalar", nOrS: displayPresetWithOther(pov) };
    }
    return null;
  }
  if (Array.isArray(v)) {
    const joined = v
      .map((x) => String(x).trim())
      .filter(Boolean)
      .join(", ");
    if (!joined) return null;
    return { tag: "scalar", nOrS: joined };
  }
  return { tag: "scalar", nOrS: String(v) };
}

function countNonEmptyKeys(data: Record<string, SetupSnapshotValue>): number {
  let n = 0;
  for (const v of Object.values(data)) {
    if (!snapshotValueIsEffectivelyEmpty(v)) n += 1;
  }
  return n;
}

type PerKeyState =
  | {
      kind: "multi";
      tokenDocCount: Map<string, number>;
      documentCount: number;
    }
  | {
      kind: "scalar";
      values: Array<number | string>;
    };

function getOrCreateBucket(
  map: Map<string, PerKeyState>,
  key: string,
  obs: { tag: "multi"; tokens: string[] } | { tag: "scalar"; nOrS: number | string }
): PerKeyState {
  if (obs.tag === "multi") {
    let b = map.get(key);
    if (!b || b.kind !== "multi") {
      b = { kind: "multi", tokenDocCount: new Map(), documentCount: 0 };
      map.set(key, b);
    }
    const seenInDoc = new Set<string>();
    for (const t of obs.tokens) {
      const norm = t.trim();
      if (!norm) continue;
      const lk = norm.toLowerCase();
      if (seenInDoc.has(lk)) continue;
      seenInDoc.add(lk);
      b.tokenDocCount.set(lk, (b.tokenDocCount.get(lk) ?? 0) + 1);
    }
    b.documentCount += 1;
    return b;
  }

  let b = map.get(key);
  if (!b || b.kind !== "scalar") {
    b = { kind: "scalar", values: [] };
    map.set(key, b);
  }
  b.values.push(obs.nOrS);
  return b;
}

function isBooleanDistribution(freq: Map<string, number>): boolean {
  const keys = [...freq.keys()].map((k) => k.trim().toLowerCase());
  if (keys.length === 0) return false;
  const allowed = new Set(["true", "false"]);
  return keys.every((k) => allowed.has(k));
}

function buildCategoricalJson(freq: Map<string, number>, sampleCount: number) {
  const frequencies = Object.fromEntries([...freq.entries()].sort((a, b) => b[1] - a[1]));
  return {
    distinctCount: freq.size,
    sampleCount,
    frequencies,
  };
}

export type RebuildSetupAggregationsResult = {
  deletedRows: number;
  createdRows: number;
  documentsConsidered: number;
  documentsIncluded: number;
};

/**
 * Rebuilds CAR_PARAMETER aggregations for every car owned by `userId`.
 * Sources: SetupSnapshot.data linked from eligible, parsed setup documents (not calibration examples).
 */
export async function rebuildSetupAggregationsForUserCars(
  userId: string
): Promise<RebuildSetupAggregationsResult> {
  const cars = await prisma.car.findMany({
    where: { userId },
    select: { id: true },
  });
  const carIds = cars.map((c) => c.id);
  if (carIds.length === 0) {
    return { deletedRows: 0, createdRows: 0, documentsConsidered: 0, documentsIncluded: 0 };
  }

  const exampleRows = await prisma.setupSheetCalibration.findMany({
    where: { exampleDocumentId: { not: null } },
    select: { exampleDocumentId: true },
  });
  const exampleDocIds = new Set(
    exampleRows
      .map((r) => r.exampleDocumentId)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );

  const documents = await prisma.setupDocument.findMany({
    where: {
      eligibleForAggregationDataset: true,
      parseStatus: { in: ["PARSED", "PARTIAL"] },
      createdSetupId: { not: null },
      id: { notIn: [...exampleDocIds] },
      createdSetup: {
        carId: { in: carIds },
        car: { userId },
      },
    },
    select: {
      id: true,
      createdSetup: {
        select: {
          carId: true,
          data: true,
        },
      },
    },
  });

  const byCar = new Map<string, Map<string, PerKeyState>>();

  let documentsIncluded = 0;
  for (const doc of documents) {
    const snap = doc.createdSetup;
    if (!snap?.carId) continue;
    const raw = snap.data;
    const data = normalizeSetupSnapshotForStorage(
      raw && typeof raw === "object" ? raw : {}
    ) as Record<string, SetupSnapshotValue>;

    if (countNonEmptyKeys(data) < MIN_DISTINCT_KEYS_FOR_ELIGIBILITY) continue;
    documentsIncluded += 1;

    let keyMap = byCar.get(snap.carId);
    if (!keyMap) {
      keyMap = new Map();
      byCar.set(snap.carId, keyMap);
    }

    for (const [key, val] of Object.entries(data)) {
      const obs = extractObservation(key, val);
      if (!obs) continue;
      getOrCreateBucket(keyMap, key, obs);
    }
  }

  const rows: Prisma.SetupParameterAggregationCreateManyInput[] = [];

  for (const [carId, keyMap] of byCar) {
    const scopeKey = carId;
    for (const [parameterKey, state] of keyMap) {
      if (state.kind === "multi") {
        const freq = state.tokenDocCount;
        rows.push({
          scopeType: SetupAggregationScopeType.CAR_PARAMETER,
          scopeKey,
          carId,
          parameterKey,
          valueType: SetupAggregationValueType.MULTI_SELECT,
          sampleCount: state.documentCount,
          categoricalStatsJson: {
            kind: "multi_select_token_document_frequency",
            sampleCount: state.documentCount,
            tokenDocumentFrequency: Object.fromEntries(
              [...freq.entries()].sort((a, b) => b[1] - a[1])
            ),
            distinctTokenCount: freq.size,
          },
        });
        continue;
      }

      const vals = state.values;
      const allNumeric = vals.every((x) => typeof x === "number");
      if (allNumeric && vals.length > 0) {
        const stats = computeNumericStats(vals as number[]);
        if (stats) {
          rows.push({
            scopeType: SetupAggregationScopeType.CAR_PARAMETER,
            scopeKey,
            carId,
            parameterKey,
            valueType: SetupAggregationValueType.NUMERIC,
            sampleCount: stats.sampleCount,
            numericStatsJson: stats,
          });
        }
        continue;
      }

      const freq = new Map<string, number>();
      for (const x of vals) {
        const s = typeof x === "number" ? String(x) : String(x).trim();
        if (s === "") continue;
        freq.set(s, (freq.get(s) ?? 0) + 1);
      }
      const sampleCount = [...freq.values()].reduce((a, b) => a + b, 0);
      if (sampleCount === 0) continue;

      const bool = isBooleanDistribution(freq);
      rows.push({
        scopeType: SetupAggregationScopeType.CAR_PARAMETER,
        scopeKey,
        carId,
        parameterKey,
        valueType: bool ? SetupAggregationValueType.BOOLEAN : SetupAggregationValueType.CATEGORICAL,
        sampleCount,
        categoricalStatsJson: buildCategoricalJson(freq, sampleCount),
      });
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const del = await tx.setupParameterAggregation.deleteMany({
      where: {
        scopeType: SetupAggregationScopeType.CAR_PARAMETER,
        carId: { in: carIds },
      },
    });
    if (rows.length > 0) {
      await tx.setupParameterAggregation.createMany({ data: rows });
    }
    return { deleted: del.count, created: rows.length };
  });

  return {
    deletedRows: result.deleted,
    createdRows: result.created,
    documentsConsidered: documents.length,
    documentsIncluded,
  };
}
