import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  MIN_DISTINCT_KEYS_FOR_ELIGIBILITY,
  communityTemplateAggregationRowsFromPerKeyMap,
  countNonEmptyKeys,
  extractObservation,
  getOrCreateBucket,
  resolveNormalizedAggregationData,
  type PerKeyState,
} from "@/lib/setupAggregations/eligibleDocAggregationCore";
import { geometryDerivedScalarObservations } from "@/lib/setupAggregations/setupGeometryDerivedMetrics";
import { GRIP_BUCKET_ANY, gripBucketsForDoc } from "@/lib/setupAggregations/gripBuckets";
import { canonicalSetupSheetTemplateId } from "@/lib/setupSheetTemplateId";

export type RebuildCommunityAggregationsExclusionCounts = {
  totalDocumentsExamined: number;
  excludedNotEligible: number;
  excludedParseStatus: number;
  excludedNoPayload: number;
  excludedNoCar: number;
  excludedNoTemplate: number;
  excludedNoSurface: number;
  excludedSparseData: number;
  eligibleDocuments: number;
};

export type RebuildCommunityAggregationsResult = {
  deletedRows: number;
  createdRows: number;
  documentsIncluded: number;
  exclusionCounts: RebuildCommunityAggregationsExclusionCounts;
};

/**
 * Rebuilds community (app-wide) aggregations: all setup PDFs marked eligible for the aggregation dataset,
 * bucketed by the linked car's `setupSheetTemplate`.
 */
export async function rebuildCommunityTemplateAggregations(): Promise<RebuildCommunityAggregationsResult> {
  const exampleRows = await prisma.setupSheetCalibration.findMany({
    where: { exampleDocumentId: { not: null } },
    select: { exampleDocumentId: true },
  });
  const exampleDocIds = new Set(
    exampleRows
      .map((r) => r.exampleDocumentId)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );

  const exclusionCounts: RebuildCommunityAggregationsExclusionCounts = {
    totalDocumentsExamined: 0,
    excludedNotEligible: 0,
    excludedParseStatus: 0,
    excludedNoPayload: 0,
    excludedNoCar: 0,
    excludedNoTemplate: 0,
    excludedNoSurface: 0,
    excludedSparseData: 0,
    eligibleDocuments: 0,
  };

  const candidates = await prisma.setupDocument.findMany({
    where: {
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
  });

  exclusionCounts.totalDocumentsExamined = candidates.length;

  const carIdSet = new Set<string>();
  for (const doc of candidates) {
    const cid = doc.createdSetup?.carId ?? doc.carId;
    if (cid) carIdSet.add(cid);
  }
  const cars = await prisma.car.findMany({
    where: { id: { in: [...carIdSet] } },
    select: { id: true, setupSheetTemplate: true },
  });
  const templateByCarId = new Map(cars.map((c) => [c.id, c.setupSheetTemplate]));

  // key = `${template}\x1e${surface}\x1e${gripBucket}` -> per-parameter observation buckets.
  // A single doc may land in multiple grip buckets (always `any`, plus one per matching traction tag).
  const byTemplateSurfaceGrip = new Map<string, Map<string, PerKeyState>>();
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
    if (!effectiveCarId) {
      exclusionCounts.excludedNoCar += 1;
      continue;
    }

    const rawTemplate = templateByCarId.get(effectiveCarId)?.trim() ?? "";
    if (!rawTemplate) {
      exclusionCounts.excludedNoTemplate += 1;
      continue;
    }
    const templateForBucket = canonicalSetupSheetTemplateId(rawTemplate) ?? rawTemplate;

    const surfaceRaw = String((data as Record<string, unknown>)["track_surface"] ?? "").trim().toLowerCase();
    const trackSurface = surfaceRaw === "asphalt" || surfaceRaw === "carpet" ? surfaceRaw : "";
    if (!trackSurface) {
      exclusionCounts.excludedNoSurface += 1;
      continue;
    }

    if (countNonEmptyKeys(data) < MIN_DISTINCT_KEYS_FOR_ELIGIBILITY) {
      exclusionCounts.excludedSparseData += 1;
      continue;
    }

    exclusionCounts.eligibleDocuments += 1;
    documentsIncluded += 1;

    const gripBuckets = gripBucketsForDoc(data);
    // Precompute observations once per doc, then fan them out to all grip buckets this doc claims.
    const obsPerKey: Array<[
      string,
      { tag: "multi"; tokens: string[] } | { tag: "scalar"; nOrS: number | string }
    ]> = [];
    for (const [key, val] of Object.entries(data)) {
      const obs = extractObservation(key, val);
      if (!obs) continue;
      obsPerKey.push([key, obs]);
    }
    for (const [dk, obs] of geometryDerivedScalarObservations(data)) {
      obsPerKey.push([dk, obs]);
    }

    for (const bucket of gripBuckets) {
      const bucketKey = `${templateForBucket}\x1e${trackSurface}\x1e${bucket}`;
      let keyMap = byTemplateSurfaceGrip.get(bucketKey);
      if (!keyMap) {
        keyMap = new Map();
        byTemplateSurfaceGrip.set(bucketKey, keyMap);
      }
      for (const [k, obs] of obsPerKey) {
        getOrCreateBucket(keyMap, k, obs);
      }
    }
  }

  const rows: Prisma.CommunitySetupParameterAggregationCreateManyInput[] = [];
  for (const [bucketKey, keyMap] of byTemplateSurfaceGrip) {
    const parts = bucketKey.split("\x1e");
    const template = parts[0] ?? "";
    const trackSurface = parts[1] ?? "";
    const gripLevel = parts[2] ?? GRIP_BUCKET_ANY;
    rows.push(
      ...communityTemplateAggregationRowsFromPerKeyMap(
        template,
        trackSurface,
        gripLevel,
        keyMap
      )
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const del = await tx.communitySetupParameterAggregation.deleteMany({});
    if (rows.length > 0) {
      await tx.communitySetupParameterAggregation.createMany({ data: rows });
    }
    return { deleted: del.count, created: rows.length };
  });

  return {
    deletedRows: result.deleted,
    createdRows: result.created,
    documentsIncluded,
    exclusionCounts,
  };
}
