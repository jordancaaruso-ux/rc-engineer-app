import type { Prisma } from "@prisma/client";
import { SetupAggregationScopeType, SetupAggregationValueType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { encodeTrackConditionSignature } from "@/lib/trackConditionSignature";
import type { SetupSnapshotValue } from "@/lib/runSetup";
import { normalizeSetupSnapshotForStorage } from "@/lib/runSetup";
import {
  MIN_DISTINCT_KEYS_FOR_ELIGIBILITY,
  aggregationRowsFromPerKeyMap,
  countNonEmptyKeys,
  extractObservation,
  filterTuningKeysOnly,
  getOrCreateBucket,
  resolveNormalizedAggregationData,
  snapshotDataHasKeys,
  type PerKeyState,
} from "@/lib/setupAggregations/eligibleDocAggregationCore";
import { geometryDerivedScalarObservations } from "@/lib/setupAggregations/setupGeometryDerivedMetrics";

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
  conditionDeletedRows: number;
  conditionCreatedRows: number;
  /** @deprecated prefer exclusionCounts.eligibleDocuments + documentsIncluded */
  documentsConsidered: number;
  documentsIncluded: number;
  exclusionCounts: RebuildSetupAggregationsExclusionCounts;
};

async function buildCarParameterConditionRowsFromRuns(
  userId: string,
  carIds: string[]
): Promise<Prisma.SetupParameterAggregationCreateManyInput[]> {
  if (carIds.length === 0) return [];

  const runs = await prisma.run.findMany({
    where: {
      userId,
      carId: { in: carIds },
      track: { isNot: null },
    },
    select: {
      carId: true,
      setupSnapshot: { select: { data: true } },
      track: { select: { gripTags: true, layoutTags: true } },
    },
  });

  /** carId + condition signature → per-key state */
  const buckets = new Map<string, Map<string, PerKeyState>>();

  for (const run of runs) {
    if (!run.carId || !run.track) continue;
    const raw = run.setupSnapshot?.data;
    if (!snapshotDataHasKeys(raw)) continue;
    const normalized = normalizeSetupSnapshotForStorage(raw) as Record<string, SetupSnapshotValue>;
    const tuningOnly = filterTuningKeysOnly(normalized);
    if (countNonEmptyKeys(tuningOnly) < MIN_DISTINCT_KEYS_FOR_ELIGIBILITY) continue;

    const conditionSig = encodeTrackConditionSignature(run.track.gripTags, run.track.layoutTags);
    const bk = `${run.carId}\x1e${conditionSig}`;
    let keyMap = buckets.get(bk);
    if (!keyMap) {
      keyMap = new Map();
      buckets.set(bk, keyMap);
    }

    for (const [key, val] of Object.entries(tuningOnly)) {
      const obs = extractObservation(key, val);
      if (!obs) continue;
      getOrCreateBucket(keyMap, key, obs);
    }
  }

  const rows: Prisma.SetupParameterAggregationCreateManyInput[] = [];
  for (const [bk, keyMap] of buckets) {
    const sep = bk.indexOf("\x1e");
    const carId = bk.slice(0, sep);
    const scopeKey = bk.slice(sep + 1);
    rows.push(
      ...aggregationRowsFromPerKeyMap(
        SetupAggregationScopeType.CAR_PARAMETER_CONDITION,
        scopeKey,
        carId,
        keyMap
      )
    );
  }
  return rows;
}

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
    for (const [dk, obs] of geometryDerivedScalarObservations(data)) {
      getOrCreateBucket(keyMap, dk, obs);
    }
  }

  const rows: Prisma.SetupParameterAggregationCreateManyInput[] = [];

  for (const [carId, keyMap] of byCar) {
    const scopeKey = carId;
    rows.push(
      ...aggregationRowsFromPerKeyMap(
        SetupAggregationScopeType.CAR_PARAMETER,
        scopeKey,
        carId,
        keyMap
      )
    );
  }

  const conditionRows = await buildCarParameterConditionRowsFromRuns(userId, carIds);

  const result = await prisma.$transaction(async (tx) => {
    const delCar =
      carIds.length > 0
        ? await tx.setupParameterAggregation.deleteMany({
            where: {
              scopeType: SetupAggregationScopeType.CAR_PARAMETER,
              carId: { in: carIds },
            },
          })
        : { count: 0 };
    const delCond =
      carIds.length > 0
        ? await tx.setupParameterAggregation.deleteMany({
            where: {
              scopeType: SetupAggregationScopeType.CAR_PARAMETER_CONDITION,
              carId: { in: carIds },
            },
          })
        : { count: 0 };
    if (rows.length > 0) {
      await tx.setupParameterAggregation.createMany({ data: rows });
    }
    if (conditionRows.length > 0) {
      await tx.setupParameterAggregation.createMany({ data: conditionRows });
    }
    return {
      deleted: delCar.count,
      created: rows.length,
      conditionDeleted: delCond.count,
      conditionCreated: conditionRows.length,
    };
  });

  return {
    deletedRows: result.deleted,
    createdRows: result.created,
    conditionDeletedRows: result.conditionDeleted,
    conditionCreatedRows: result.conditionCreated,
    documentsConsidered: exclusionCounts.eligibleDocuments,
    documentsIncluded,
    exclusionCounts,
  };
}
