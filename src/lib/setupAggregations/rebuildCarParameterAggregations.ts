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
import { normalizeParsedSetupData } from "@/lib/setupDocuments/normalize";

/** At least this many non-empty parameter keys required on the snapshot to count toward aggregation. */
const MIN_DISTINCT_KEYS_FOR_ELIGIBILITY = 2;

function snapshotDataHasKeys(raw: unknown): boolean {
  return raw != null && typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length > 0;
}

/**
 * Prefer committed SetupSnapshot.data; otherwise normalized parsed PDF output.
 * Car id: createdSetup.carId when present, else SetupDocument.carId from upload.
 */
function resolveNormalizedAggregationData(
  parsedDataJson: unknown,
  createdSetup: { data: unknown } | null
): Record<string, SetupSnapshotValue> | null {
  if (createdSetup && snapshotDataHasKeys(createdSetup.data)) {
    return normalizeSetupSnapshotForStorage(createdSetup.data) as Record<string, SetupSnapshotValue>;
  }
  if (snapshotDataHasKeys(parsedDataJson)) {
    return normalizeSetupSnapshotForStorage(
      normalizeParsedSetupData(parsedDataJson)
    ) as Record<string, SetupSnapshotValue>;
  }
  return null;
}

/** Car for bucketing: explicit id, else the user's only car (safe when unambiguous). */
function resolveAggregationCarId(
  snapshotCarId: string | null | undefined,
  userCarIds: string[]
): { carId: string | null; ambiguous: boolean; wrongOwner: boolean } {
  if (snapshotCarId) {
    if (userCarIds.includes(snapshotCarId)) return { carId: snapshotCarId, ambiguous: false, wrongOwner: false };
    return { carId: null, ambiguous: false, wrongOwner: true };
  }
  if (userCarIds.length === 1) return { carId: userCarIds[0]!, ambiguous: false, wrongOwner: false };
  if (userCarIds.length === 0) return { carId: null, ambiguous: false, wrongOwner: false };
  return { carId: null, ambiguous: true, wrongOwner: false };
}

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

export type RebuildSetupAggregationsExclusionCounts = {
  /** All non-example setup documents for this user (examination set). */
  totalUserDocuments: number;
  excludedNotEligible: number;
  excludedParseStatus: number;
  excludedPlaceholder: number;
  excludedNoPayload: number;
  excludedNoCar: number;
  excludedAmbiguousCar: number;
  excludedSnapshotCarWrongOwner: number;
  excludedSparseData: number;
  eligibleDocuments: number;
};

export type RebuildSetupAggregationsResult = {
  deletedRows: number;
  createdRows: number;
  /** @deprecated prefer exclusionCounts.eligibleDocuments + documentsIncluded */
  documentsConsidered: number;
  documentsIncluded: number;
  exclusionCounts: RebuildSetupAggregationsExclusionCounts;
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

  const exampleRows = await prisma.setupSheetCalibration.findMany({
    where: { exampleDocumentId: { not: null } },
    select: { exampleDocumentId: true },
  });
  const exampleDocIds = new Set(
    exampleRows
      .map((r) => r.exampleDocumentId)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );

  const exclusionCounts: RebuildSetupAggregationsExclusionCounts = {
    totalUserDocuments: 0,
    excludedNotEligible: 0,
    excludedParseStatus: 0,
    excludedPlaceholder: 0,
    excludedNoPayload: 0,
    excludedNoCar: 0,
    excludedAmbiguousCar: 0,
    excludedSnapshotCarWrongOwner: 0,
    excludedSparseData: 0,
    eligibleDocuments: 0,
  };

  const [excludedPlaceholderCount, candidates] = await Promise.all([
    exampleDocIds.size === 0
      ? Promise.resolve(0)
      : prisma.setupDocument.count({
          where: { userId, id: { in: [...exampleDocIds] } },
        }),
    prisma.setupDocument.findMany({
      where: {
        userId,
        id: { notIn: [...exampleDocIds] },
      },
      select: {
        eligibleForAggregationDataset: true,
        parseStatus: true,
        parsedDataJson: true,
        carId: true,
        createdSetup: {
          select: {
            carId: true,
            data: true,
          },
        },
      },
    }),
  ]);

  exclusionCounts.excludedPlaceholder = excludedPlaceholderCount;
  exclusionCounts.totalUserDocuments = candidates.length + excludedPlaceholderCount;

  const byCar = new Map<string, Map<string, PerKeyState>>();

  let documentsIncluded = 0;
  for (const doc of candidates) {
    if (!doc.eligibleForAggregationDataset) {
      exclusionCounts.excludedNotEligible += 1;
      continue;
    }
    if (doc.parseStatus !== "PARSED" && doc.parseStatus !== "PARTIAL") {
      exclusionCounts.excludedParseStatus += 1;
      continue;
    }

    const data = resolveNormalizedAggregationData(doc.parsedDataJson, doc.createdSetup);
    if (!data) {
      exclusionCounts.excludedNoPayload += 1;
      continue;
    }

    const effectiveCarId = doc.createdSetup?.carId ?? doc.carId ?? null;
    const { carId: resolvedCarId, ambiguous, wrongOwner } = resolveAggregationCarId(
      effectiveCarId,
      carIds
    );
    if (wrongOwner) {
      exclusionCounts.excludedSnapshotCarWrongOwner += 1;
      continue;
    }
    if (ambiguous) {
      exclusionCounts.excludedAmbiguousCar += 1;
      continue;
    }
    if (!resolvedCarId) {
      exclusionCounts.excludedNoCar += 1;
      continue;
    }

    if (countNonEmptyKeys(data) < MIN_DISTINCT_KEYS_FOR_ELIGIBILITY) {
      exclusionCounts.excludedSparseData += 1;
      continue;
    }

    exclusionCounts.eligibleDocuments += 1;
    documentsIncluded += 1;

    let keyMap = byCar.get(resolvedCarId);
    if (!keyMap) {
      keyMap = new Map();
      byCar.set(resolvedCarId, keyMap);
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
    const del =
      carIds.length > 0
        ? await tx.setupParameterAggregation.deleteMany({
            where: {
              scopeType: SetupAggregationScopeType.CAR_PARAMETER,
              carId: { in: carIds },
            },
          })
        : { count: 0 };
    if (rows.length > 0) {
      await tx.setupParameterAggregation.createMany({ data: rows });
    }
    return { deleted: del.count, created: rows.length };
  });

  return {
    deletedRows: result.deleted,
    createdRows: result.created,
    documentsConsidered: exclusionCounts.eligibleDocuments,
    documentsIncluded,
    exclusionCounts,
  };
}
