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
import { iterateAggregationSourceDocs } from "@/lib/setupAggregations/iterateAggregationDocs";
import { geometryDerivedScalarObservations } from "@/lib/setupAggregations/setupGeometryDerivedMetrics";
import { GRIP_BUCKET_ANY, gripBucketsForDoc } from "@/lib/setupAggregations/gripBuckets";
import { canonicalSetupSheetTemplateId } from "@/lib/setupSheetTemplateId";
import { templateKeyFromModelSlug } from "@/lib/setupSheetModels/resolveModelForCar";
import {
  UNIVERSAL_TOURING_TEMPLATE_ID,
  resolveUniversalParameterId,
  universalParameterIdsBySchemaKey,
} from "@/lib/setupSheetModels/universalParameters";

export type RebuildCommunityAggregationsExclusionCounts = {
  totalDocumentsExamined: number;
  excludedNotEligible: number;
  excludedParseStatus: number;
  excludedNoPayload: number;
  excludedNoCar: number;
  excludedNoTemplate: number;
  excludedUnverifiedTemplate: number;
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
    excludedUnverifiedTemplate: 0,
    excludedNoSurface: 0,
    excludedSparseData: 0,
    eligibleDocuments: 0,
  };

  // This is the one app-wide scan in the codebase: it walks *every* user's setup documents,
  // so it grows with the whole corpus rather than with one account. Two rules keep it cheap:
  //   1. The eligibility gates that used to run in JS now run in the `where` clause, so the
  //      fat `parsedDataJson` blob is never fetched for a doc we were going to skip anyway.
  //   2. The scan is cursor-paged, so peak memory and connection time stay flat as the
  //      corpus grows instead of materializing every parsed sheet at once.
  // The excluded-by-gate tallies below come from counts instead of from the loop.
  const notExampleWhere: Prisma.SetupDocumentWhereInput = { id: { notIn: [...exampleDocIds] } };
  const includableWhere: Prisma.SetupDocumentWhereInput = {
    ...notExampleWhere,
    eligibleForAggregationDataset: true,
    parseStatus: { in: ["PARSED", "PARTIAL"] },
  };

  const [totalExamined, notEligibleCount, wrongParseStatusCount] = await Promise.all([
    prisma.setupDocument.count({ where: notExampleWhere }),
    prisma.setupDocument.count({
      where: { ...notExampleWhere, eligibleForAggregationDataset: false },
    }),
    prisma.setupDocument.count({
      where: {
        ...notExampleWhere,
        eligibleForAggregationDataset: true,
        parseStatus: { notIn: ["PARSED", "PARTIAL"] },
      },
    }),
  ]);
  exclusionCounts.totalDocumentsExamined = totalExamined;
  exclusionCounts.excludedNotEligible = notEligibleCount;
  exclusionCounts.excludedParseStatus = wrongParseStatusCount;

  // Car-id prepass: ids only, no parsed payload. Only includable docs can reach the bucket
  // loop, so narrowing this to the same filter cannot change which templates get resolved.
  const carIdRows = await prisma.setupDocument.findMany({
    where: includableWhere,
    select: { carId: true, createdSetup: { select: { carId: true } } },
  });

  const carIdSet = new Set<string>();
  for (const doc of carIdRows) {
    const cid = doc.createdSetup?.carId ?? doc.carId;
    if (cid) carIdSet.add(cid);
  }
  const cars = await prisma.car.findMany({
    where: { id: { in: [...carIdSet] } },
    select: {
      id: true,
      setupSheetTemplate: true,
      // `schemaJson` rides along because the universal pool now asks each sheet which parameter
      // its keys mean (see `resolveUniversalParameterId`). One extra column on a query that
      // already loads the model.
      setupSheetModel: { select: { id: true, slug: true, isAuthorized: true, schemaJson: true } },
    },
  });
  // Prefer the linked model's slug (canonical template key); fall back to the stored string for
  // cars that predate model links. For A800RR both are the same value.
  //
  // Verified-identity gate (docs/ASSET_ACCESS_NORTH_STAR.md): a car linked to an UNVERIFIED
  // chassis model must not form or feed a community bucket — otherwise a user-created duplicate
  // chassis pollutes/fragments the shared field. Legacy-string cars (no model link) have no
  // unverified identity behind them, so they still count.
  const templateByCarId = new Map<string, { key: string | null; unverified: boolean }>(
    cars.map((c) => {
      if (c.setupSheetModel?.slug) {
        return [
          c.id,
          {
            key: templateKeyFromModelSlug(c.setupSheetModel.slug),
            unverified: !c.setupSheetModel.isAuthorized,
          },
        ];
      }
      return [c.id, { key: c.setupSheetTemplate, unverified: false }];
    })
  );

  // Car -> its sheet's declared universal parameters. Built once per MODEL and shared by every car
  // on it, because a popular chassis brings hundreds of cars through here and the map is identical
  // for all of them. Cars with no linked model (legacy string templates) get no map and fall back
  // to the alias table, exactly as before.
  const universalIdsByModelId = new Map<string, ReadonlyMap<string, string>>();
  const universalIdsByCarId = new Map<string, ReadonlyMap<string, string>>();
  for (const c of cars) {
    const model = c.setupSheetModel;
    if (!model) continue;
    let ids = universalIdsByModelId.get(model.id);
    if (!ids) {
      ids = universalParameterIdsBySchemaKey(model.schemaJson as { fields?: unknown } | null);
      universalIdsByModelId.set(model.id, ids);
    }
    if (ids.size > 0) universalIdsByCarId.set(c.id, ids);
  }

  // key = `${template}\x1e${surface}\x1e${gripBucket}` -> per-parameter observation buckets.
  // A single doc may land in multiple grip buckets (always `any`, plus one per matching traction tag).
  const byTemplateSurfaceGrip = new Map<string, Map<string, PerKeyState>>();
  let documentsIncluded = 0;

  // Eligibility and parse-status gates live in `includableWhere` now, so every doc that
  // arrives here is one we intend to aggregate.
  for await (const doc of iterateAggregationSourceDocs(includableWhere)) {
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

    const templateEntry = templateByCarId.get(effectiveCarId);
    if (templateEntry?.unverified) {
      exclusionCounts.excludedUnverifiedTemplate += 1;
      continue;
    }
    const rawTemplate = templateEntry?.key?.trim() ?? "";
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

    const docUniversalIds = universalIdsByCarId.get(effectiveCarId) ?? null;

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

      const universalBucketKey = `${UNIVERSAL_TOURING_TEMPLATE_ID}\x1e${trackSurface}\x1e${bucket}`;
      let universalMap = byTemplateSurfaceGrip.get(universalBucketKey);
      if (!universalMap) {
        universalMap = new Map();
        byTemplateSurfaceGrip.set(universalBucketKey, universalMap);
      }
      // The cross-car pool is keyed by the universal parameter, not by this sheet's own key —
      // that is what lets a PDF-derived sheet keyed `text47` pool with a generic sheet's
      // `droop_front`. Sheets that declare nothing resolve through the alias table to the same
      // id they bucketed under before, so this is a no-op for the existing catalog.
      for (const [k, obs] of obsPerKey) {
        const universalId = resolveUniversalParameterId(k, docUniversalIds);
        if (!universalId) continue;
        getOrCreateBucket(universalMap, universalId, obs);
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
