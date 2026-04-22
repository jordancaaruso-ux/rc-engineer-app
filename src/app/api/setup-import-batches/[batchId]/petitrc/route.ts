import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { resolveOwnedCarId } from "@/lib/cars/resolveOwnedCarId";
import { canonicalSetupTemplateForUserCarId } from "@/lib/carSetupScope";
import { SetupDocumentImportStages } from "@/lib/setupDocuments/importStages";
import { StorageConfigurationError, storeSetupDocumentFile } from "@/lib/setupDocuments/storage";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";
import { discoverPetitRcSetupPdfs, fetchPetitRcPdfBytes } from "@/lib/petitrc/discoverPetitRcPdfs";
import { createHash } from "node:crypto";
import { processSetupDocumentImport } from "@/lib/setupDocuments/processImport";
import { ALLOWED_CALIBRATION_NAMES } from "@/lib/petitrc/allowedCalibrations";
import {
  buildCalibrationFingerprints,
  repickCalibrationForBytes,
  type CalibrationFingerprint,
  type RepickOutcome,
} from "@/lib/setupCalibrations/autoPickCalibration";

const PDF_MIME = "application/pdf";
const SOURCE_SITE = "petitrc";
// Keep this conservative: long PDF parsing can be slow. We enqueue work in a background chain so the API returns
// quickly, and the queue runs sequentially in the dev server process.
//
// NOTE: In serverless deployments, this should be replaced with a durable background queue.
const AUTO_PROCESS_LIMIT = 500;
let backgroundProcessChain: Promise<void> = Promise.resolve();
function enqueueBackgroundProcess(input: { docId: string; userId: string }) {
  backgroundProcessChain = backgroundProcessChain
    .then(async () => {
      await processSetupDocumentImport({ docId: input.docId, userId: input.userId });
    })
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[petitrc/autoProcess] doc=${input.docId} failed error=${msg}`);
    });
}

type Ctx = { params: Promise<{ batchId: string }> };

type Body = {
  url?: string;
  carId?: string;
  maxPdfs?: number;
  dryRun?: boolean;
  /** When true, attempt to pick a calibration based on PDF form-field fingerprint. */
  autoCalibration?: boolean;
  /** When a duplicate PDF is found, reuse the existing doc if it still needs review. */
  reuseExistingIfNotEligible?: boolean;
  /** When true, immediately run parse/import pipeline after creating or reusing docs. */
  autoProcess?: boolean;
  /**
   * When true (default when autoCalibration is true), re-fingerprint an existing reused doc against
   * the allowed calibration set and update its calibration when an exact match is found and differs
   * from the currently stored one. Use this to "heal" docs that were imported under an older rule.
   */
  repickCalibrationOnReuse?: boolean;
};

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function backfillUserPdfHashes(input: { userId: string; limit: number }): Promise<void> {
  const docs = await prisma.setupDocument.findMany({
    where: {
      userId: input.userId,
      mimeType: PDF_MIME,
      sourceContentSha256: null,
    },
    orderBy: { createdAt: "desc" },
    take: input.limit,
    select: { id: true, storagePath: true },
  });
  for (const d of docs) {
    try {
      const bytes = await readBytesFromStorageRef(d.storagePath);
      const hash = sha256Hex(new Uint8Array(bytes));
      await prisma.setupDocument.updateMany({
        where: { id: d.id, userId: input.userId, sourceContentSha256: null },
        data: { sourceContentSha256: hash },
      });
    } catch {
      // ignore unreadable legacy blobs; they just won't dedupe
    }
  }
}

export async function POST(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { batchId } = await ctx.params;

  const batch = await prisma.setupImportBatch.findFirst({
    where: { id: batchId, userId: user.id },
    select: { id: true },
  });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Body;
  const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
  if (!rawUrl) return NextResponse.json({ error: "url is required" }, { status: 400 });

  const carResolved = await resolveOwnedCarId(user.id, body.carId ?? null);
  if (!carResolved.ok) {
    return NextResponse.json({ error: carResolved.message }, { status: 400 });
  }
  const setupSheetTemplate = await canonicalSetupTemplateForUserCarId(user.id, carResolved.carId);

  const maxPdfs =
    typeof body.maxPdfs === "number" && Number.isFinite(body.maxPdfs) && body.maxPdfs > 0
      ? Math.min(Math.floor(body.maxPdfs), 2000)
      : 500;

  // Some hubs list hundreds+ of folders; do not cap this so low that we repeatedly import the same first chunk.
  const discovered = await discoverPetitRcSetupPdfs(rawUrl, { maxPdfs, maxFolders: 2000 });
  if (discovered.length === 0) {
    return NextResponse.json({ error: "No setup PDFs found at that PetitRC URL." }, { status: 404 });
  }

  const dryRun = body.dryRun === true;
  const autoCalibration = body.autoCalibration !== false;
  const reuseExistingIfNotEligible = body.reuseExistingIfNotEligible !== false;
  const autoProcess = body.autoProcess !== false;
  const repickCalibrationOnReuse = body.repickCalibrationOnReuse !== false && autoCalibration;

  const calCandidates = autoCalibration
    ? await buildCalibrationFingerprints({
        userId: user.id,
        restrictToNames: ALLOWED_CALIBRATION_NAMES,
      })
    : [];
  const missingCalibrationNames = autoCalibration
    ? ALLOWED_CALIBRATION_NAMES.filter(
        (n) => !calCandidates.some((c) => c.calibrationName === n)
      )
    : [];

  const existing = await prisma.setupDocument.findMany({
    where: {
      userId: user.id,
      sourceSite: SOURCE_SITE,
      sourceUrl: { in: discovered.map((d) => d.url) },
    },
    select: { sourceUrl: true },
  });
  const alreadyImported = new Set(existing.map((e) => e.sourceUrl).filter((x): x is string => typeof x === "string" && x.length > 0));

  // Best-effort backfill: populate hashes for recent PDFs so we can dedupe against older imports
  // that predate `sourceUrl`.
  await backfillUserPdfHashes({ userId: user.id, limit: 250 });

  const created: Array<{
    documentId: string;
    url: string;
    originalFilename: string;
    calibrationPickedId: string | null;
    calibrationPickedName: string | null;
    calibrationDebug: string;
  }> = [];
  const reused: Array<{ documentId: string; url: string; reason: string }> = [];
  const skipped: Array<{ url: string; reason: string }> = [];
  const processed: Array<{ documentId: string; ok: boolean; error?: string }> = [];
  const queuedForProcessing: Array<{ documentId: string; reason: string }> = [];
  let processBudget = AUTO_PROCESS_LIMIT;

  for (const item of discovered) {
    if (alreadyImported.has(item.url)) {
      if (reuseExistingIfNotEligible) {
        const ex = await prisma.setupDocument.findFirst({
          where: { userId: user.id, sourceSite: SOURCE_SITE, sourceUrl: item.url },
          select: {
            id: true,
            storagePath: true,
            eligibleForAggregationDataset: true,
            parseStatus: true,
            calibrationProfileId: true,
          },
        });
        if (ex && (!ex.eligibleForAggregationDataset || (ex.parseStatus !== "PARSED" && ex.parseStatus !== "PARTIAL"))) {
          let repickReason = "";
          if (repickCalibrationOnReuse) {
            try {
              const bytes = await readBytesFromStorageRef(ex.storagePath);
              const outcome = await repickCalibrationForBytes(new Uint8Array(bytes), calCandidates, {
                debugPrefix: "petitrc:auto",
              });
              const updateData: {
                setupImportBatchId: string;
                calibrationProfileId?: string | null;
                calibrationResolvedProfileId?: string | null;
                calibrationResolvedSource?: string;
                calibrationResolvedDebug?: string;
              } = { setupImportBatchId: batch.id };
              if (outcome.pickedCalibrationId) {
                if (ex.calibrationProfileId !== outcome.pickedCalibrationId) {
                  updateData.calibrationProfileId = outcome.pickedCalibrationId;
                  repickReason = `; calibration=${outcome.pickedCalibrationName} (changed)`;
                } else {
                  repickReason = `; calibration=${outcome.pickedCalibrationName}`;
                }
                updateData.calibrationResolvedProfileId = outcome.pickedCalibrationId;
                updateData.calibrationResolvedSource = outcome.pickSource;
                updateData.calibrationResolvedDebug = outcome.pickDebug;
              } else {
                updateData.calibrationResolvedSource = outcome.pickSource;
                updateData.calibrationResolvedDebug = outcome.pickDebug;
                repickReason = `; ${outcome.pickDebug}`;
              }
              await prisma.setupDocument.update({
                where: { id: ex.id },
                data: updateData,
                select: { id: true },
              });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              await prisma.setupDocument.update({
                where: { id: ex.id },
                data: { setupImportBatchId: batch.id },
                select: { id: true },
              });
              repickReason = `; repick_failed=${msg}`;
            }
          } else {
            await prisma.setupDocument.update({
              where: { id: ex.id },
              data: { setupImportBatchId: batch.id },
              select: { id: true },
            });
          }
          reused.push({ documentId: ex.id, url: item.url, reason: `Reused existing doc (URL dedupe)${repickReason}` });
          if (autoProcess && processBudget > 0) {
            processBudget -= 1;
            enqueueBackgroundProcess({ docId: ex.id, userId: user.id });
            queuedForProcessing.push({ documentId: ex.id, reason: `autoProcess: reused(url)${repickReason}` });
          }
          continue;
        }
      }
      skipped.push({ url: item.url, reason: "Already imported (source URL dedupe)" });
      continue;
    }
    try {
      const dl = await fetchPetitRcPdfBytes(item.url);
      const bytes = dl.bytes;
      if (!bytes?.length || bytes.length < 5000) {
        skipped.push({ url: item.url, reason: "Downloaded PDF was empty or too small" });
        continue;
      }

      const contentHash = sha256Hex(bytes);
      const dupByHash = await prisma.setupDocument.findFirst({
        where: { userId: user.id, sourceContentSha256: contentHash },
        select: {
          id: true,
          eligibleForAggregationDataset: true,
          parseStatus: true,
          calibrationProfileId: true,
        },
      });
      if (dupByHash) {
        if (
          reuseExistingIfNotEligible
          && (!dupByHash.eligibleForAggregationDataset || (dupByHash.parseStatus !== "PARSED" && dupByHash.parseStatus !== "PARTIAL"))
        ) {
          let hashRepickReason = "";
          const updateData: {
            setupImportBatchId: string;
            calibrationProfileId?: string | null;
            calibrationResolvedProfileId?: string | null;
            calibrationResolvedSource?: string;
            calibrationResolvedDebug?: string;
          } = { setupImportBatchId: batch.id };
          if (repickCalibrationOnReuse) {
            const outcome = await repickCalibrationForBytes(bytes, calCandidates, {
              debugPrefix: "petitrc:auto",
            });
            if (outcome.pickedCalibrationId) {
              if (dupByHash.calibrationProfileId !== outcome.pickedCalibrationId) {
                updateData.calibrationProfileId = outcome.pickedCalibrationId;
                hashRepickReason = `; calibration=${outcome.pickedCalibrationName} (changed)`;
              } else {
                hashRepickReason = `; calibration=${outcome.pickedCalibrationName}`;
              }
              updateData.calibrationResolvedProfileId = outcome.pickedCalibrationId;
              updateData.calibrationResolvedSource = outcome.pickSource;
              updateData.calibrationResolvedDebug = outcome.pickDebug;
            } else {
              updateData.calibrationResolvedSource = outcome.pickSource;
              updateData.calibrationResolvedDebug = outcome.pickDebug;
              hashRepickReason = `; ${outcome.pickDebug}`;
            }
          }
          await prisma.setupDocument.update({
            where: { id: dupByHash.id },
            data: updateData,
            select: { id: true },
          });
          reused.push({ documentId: dupByHash.id, url: item.url, reason: `Reused existing doc (hash dedupe)${hashRepickReason}` });
          if (autoProcess && processBudget > 0) {
            processBudget -= 1;
            enqueueBackgroundProcess({ docId: dupByHash.id, userId: user.id });
            queuedForProcessing.push({ documentId: dupByHash.id, reason: `autoProcess: reused(hash)${hashRepickReason}` });
          }
          continue;
        }
        skipped.push({ url: item.url, reason: "Already imported (content hash dedupe)" });
        continue;
      }

      const outcome = autoCalibration
        ? await repickCalibrationForBytes(bytes, calCandidates, { debugPrefix: "petitrc:auto" })
        : ({
            pickedCalibrationId: null,
            pickedCalibrationName: null,
            pickSource: "none",
            pickDebug: "petitrc:auto disabled",
          } satisfies RepickOutcome);
      const pickedCalibrationId = outcome.pickedCalibrationId;
      const pickedCalibrationName = outcome.pickedCalibrationName;
      const pickSource = outcome.pickSource;
      const pickDebug = outcome.pickDebug;

      if (dryRun) {
        created.push({
          documentId: "dry_run",
          url: item.url,
          originalFilename: item.suggestedFilename,
          calibrationPickedId: pickedCalibrationId,
          calibrationPickedName: pickedCalibrationName,
          calibrationDebug: pickDebug,
        });
        continue;
      }

      const file = new File([new Uint8Array(bytes)], item.suggestedFilename, { type: PDF_MIME });
      let storagePath: string;
      try {
        ({ storagePath } = await storeSetupDocumentFile(file));
      } catch (e) {
        if (e instanceof StorageConfigurationError) {
          return NextResponse.json({ error: e.message }, { status: 503 });
        }
        throw e;
      }

      const doc = await prisma.setupDocument.create({
        data: {
          userId: user.id,
          carId: carResolved.carId,
          setupSheetTemplate,
          setupImportBatchId: batch.id,
          originalFilename: item.suggestedFilename,
          storagePath,
          mimeType: PDF_MIME,
          sourceType: "PDF",
          sourceSite: SOURCE_SITE,
          sourceUrl: item.url,
          sourceContentSha256: contentHash,
          parseStatus: "PENDING",
          importStatus: "PENDING",
          currentStage: SetupDocumentImportStages.AWAITING_CALIBRATION,
          lastCompletedStage: SetupDocumentImportStages.FILE_PERSISTED,
          importDatasetReviewStatus: "UNSET",
          eligibleForAggregationDataset: false,
          ...(pickedCalibrationId ? { calibrationProfileId: pickedCalibrationId } : {}),
          calibrationResolvedProfileId: pickedCalibrationId,
          calibrationResolvedSource: pickSource,
          calibrationResolvedDebug: pickDebug,
          calibrationUsedIsForcedDefault: false,
        },
        select: { id: true },
      });

      created.push({
        documentId: doc.id,
        url: item.url,
        originalFilename: item.suggestedFilename,
        calibrationPickedId: pickedCalibrationId,
        calibrationPickedName: pickedCalibrationName,
        calibrationDebug: pickDebug,
      });
      if (autoProcess && processBudget > 0) {
        processBudget -= 1;
        enqueueBackgroundProcess({ docId: doc.id, userId: user.id });
        queuedForProcessing.push({
          documentId: doc.id,
          reason: pickedCalibrationId
            ? `autoProcess: created(exact=${pickedCalibrationName ?? pickedCalibrationId})`
            : "autoProcess: created(no_cal)",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      skipped.push({ url: item.url, reason: msg });
    }
  }

  return NextResponse.json(
    {
      discoveredCount: discovered.length,
      createdCount: created.filter((c) => c.documentId !== "dry_run").length,
      created,
      reusedCount: reused.length,
      reused,
      processedCount: processed.filter((p) => p.ok).length,
      processedFailedCount: processed.filter((p) => !p.ok).length,
      processed,
      queuedForProcessingCount: queuedForProcessing.length,
      queuedForProcessing,
      skipped,
      calibrationCandidateCount: calCandidates.length,
      calibrationCandidates: calCandidates.map((c) => ({ id: c.calibrationId, name: c.calibrationName })),
      missingCalibrationNames,
      autoProcessBudget: AUTO_PROCESS_LIMIT,
    },
    { status: 201 }
  );
}

