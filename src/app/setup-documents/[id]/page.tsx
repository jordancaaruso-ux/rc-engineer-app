import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { prisma } from "@/lib/prisma";
import { calibrationsVisibleToUserWhere } from "@/lib/setupCalibrations/calibrationAccess";
import { SetupDocumentReviewClient } from "@/components/setup-documents/SetupDocumentReviewClient";
import { AutoRefreshWhileProcessing } from "@/components/setup-documents/AutoRefreshWhileProcessing";
import { AiExtractionReviewPanel, type AiReviewField } from "@/components/setup-documents/AiExtractionReviewPanel";
import { ChassisDisambiguationPrompt, type ChassisChoice } from "@/components/setup-documents/ChassisDisambiguationPrompt";
import { UnrecognisedSheetPrompt } from "@/components/setup-documents/UnrecognisedSheetPrompt";
import {
  isUnrecognisedSheet,
  unrecognisedSheetMessage,
  type SheetNamePresence,
} from "@/lib/setupCalibrations/sheetRecognition";
import { ensureSetupDocumentCalibrationProfileId } from "@/lib/setup/effectiveCalibration";
import { normalizeCalibrationData } from "@/lib/setupCalibrations/types";
import { loadSetupSheetModelById } from "@/lib/setupSheetModels/resolveModelForCar";
import { buildSetupSheetTemplateFromParsedSchema } from "@/lib/setupSheetModels/buildSetupSheetTemplate";
import { CardPanel } from "@/components/ui/CardPanel";

export default async function SetupDocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Setup document</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
      </>
    );
  }

  const { id } = await params;
  const user = await requireCurrentUser();
  const [doc, cars, calibrations] = await Promise.all([
    prisma.setupDocument.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        originalFilename: true,
        storagePath: true,
        mimeType: true,
        sourceType: true,
        parseStatus: true,
        importStatus: true,
        importOutcome: true,
        currentStage: true,
        lastCompletedStage: true,
        importErrorMessage: true,
        importDiagnosticJson: true,
        parseStartedAt: true,
        parseFinishedAt: true,
        calibrationResolvedProfileId: true,
        calibrationResolvedSource: true,
        calibrationResolvedDebug: true,
        calibrationUsedIsForcedDefault: true,
        parserType: true,
        extractedText: true,
        parsedDataJson: true,
        calibrationProfileId: true,
        parsedCalibrationProfileId: true,
        parsedAt: true,
        parsedSetupManuallyEdited: true,
        createdAt: true,
        updatedAt: true,
        createdSetupId: true,
        carId: true,
        setupSheetModelId: true,
        setupSheetTemplate: true,
        setupSheetModel: { select: { id: true, name: true, slug: true } },
      },
    }),
    prisma.car.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }),
    prisma.setupSheetCalibration.findMany({
      where: calibrationsVisibleToUserWhere(user.id),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        sourceType: true,
        calibrationDataJson: true,
        createdAt: true,
        communityShared: true,
        setupSheetModelId: true,
        setupSheetModel: { select: { name: true } },
      },
    }),
  ]);

  if (!doc) notFound();

  const linkedCar = doc.carId
    ? await prisma.car.findFirst({
        where: { id: doc.carId, userId: user.id },
        select: {
          name: true,
          setupSheetModelId: true,
          setupSheetModel: { select: { id: true, name: true, defaultCalibrationId: true } },
        },
      })
    : null;

  let reviewSetupTemplate = null;
  let modelIdForTemplate = doc.setupSheetModelId;
  if (!modelIdForTemplate && doc.carId) {
    const carRow = await prisma.car.findFirst({
      where: { id: doc.carId, userId: user.id },
      select: { setupSheetModelId: true },
    });
    modelIdForTemplate = carRow?.setupSheetModelId ?? null;
  }
  let defaultCalibrationIdForDocModel: string | null = null;
  let docSetupSheetModelName = doc.setupSheetModel?.name ?? linkedCar?.setupSheetModel?.name ?? null;
  if (modelIdForTemplate) {
    const model = await loadSetupSheetModelById(user.id, modelIdForTemplate);
    if (model) {
      reviewSetupTemplate = buildSetupSheetTemplateFromParsedSchema(model.id, model.name, model.schema);
      docSetupSheetModelName = model.name;
    }
    // Setup sheet models are global — never scope this read by userId.
    const modelRow = await prisma.setupSheetModel.findUnique({
      where: { id: modelIdForTemplate },
      select: { defaultCalibrationId: true },
    });
    defaultCalibrationIdForDocModel = modelRow?.defaultCalibrationId ?? null;
  }
  // Resolve effective calibration without forcing defaults.
  const effectiveCalibration = await ensureSetupDocumentCalibrationProfileId({
    userId: user.id,
    setupDocumentId: doc.id,
  });

  const isImage = doc.sourceType === "IMAGE" || (doc.mimeType ?? "").startsWith("image/");

  // Cross-chassis ambiguity: the upload matched >1 chassis and hints couldn't split them. Offer a
  // tap-to-answer question instead of rendering a guessed template (quick-create sets this marker).
  const chassisDisambig =
    doc.importDiagnosticJson &&
    typeof doc.importDiagnosticJson === "object" &&
    (doc.importDiagnosticJson as { kind?: string }).kind === "needs_chassis_disambiguation_v1"
      ? ((doc.importDiagnosticJson as { candidates?: unknown }).candidates as ChassisChoice[] | undefined)
      : undefined;
  const chassisCandidates =
    Array.isArray(chassisDisambig) && !doc.setupSheetModelId ? chassisDisambig : null;

  /*
   * A rebuilt edition of a sheet we do know (2026-08-16): the file is a good fillable PDF, but the
   * calibration we used names boxes that aren't in it, so no setup was created. Computed from the
   * stored diagnostic rather than passed through from the upload response, so it also shows when
   * the driver comes back to this document later.
   */
  const namePresence = (() => {
    const mapping =
      doc.importDiagnosticJson && typeof doc.importDiagnosticJson === "object"
        ? (doc.importDiagnosticJson as { mapping?: { namePresence?: SheetNamePresence } }).mapping
        : undefined;
    const p = mapping?.namePresence;
    if (!p || typeof p.referenced !== "number" || typeof p.present !== "number") return null;
    return p;
  })();
  const unrecognisedSheet =
    namePresence && !doc.createdSetupId && isUnrecognisedSheet(namePresence) ? namePresence : null;
  let effectiveCalibrationName: string | null = null;
  if (unrecognisedSheet && effectiveCalibration.calibrationId) {
    // Calibrations are global/community-shared — this is a label for the message, not an access read.
    const calRow = await prisma.setupSheetCalibration.findUnique({
      where: { id: effectiveCalibration.calibrationId },
      select: { name: true },
    });
    effectiveCalibrationName = calRow?.name ?? null;
  }
  // Prefill the name with the chassis they picked, marked as their own edition, so two editions of
  // one car don't end up as two rows called the same thing.
  const suggestedSheetName = docSetupSheetModelName
    ? `${docSetupSheetModelName} (my sheet)`
    : (doc.originalFilename ?? "My setup sheet").replace(/\.pdf$/i, "");

  // AI-read documents get the side-by-side review panel: model schema supplies labels,
  // sections, and choice options; the AI diagnostic supplies confidence + flagged keys.
  let aiReviewFields: AiReviewField[] | null = null;
  const aiDiag =
    doc.importDiagnosticJson && typeof doc.importDiagnosticJson === "object"
      ? (doc.importDiagnosticJson as {
          kind?: string;
          confidence?: Record<string, number>;
          flaggedKeys?: string[];
          disagreedKeys?: string[];
        })
      : null;
  let aiReviewSheetAspect: number | undefined;
  if (aiDiag?.kind === "ai_extraction_diagnostic_v1" && modelIdForTemplate && isImage) {
    const model = await loadSetupSheetModelById(user.id, modelIdForTemplate);
    if (model) {
      const parsed =
        doc.parsedDataJson && typeof doc.parsedDataJson === "object"
          ? (doc.parsedDataJson as Record<string, unknown>)
          : {};
      const flaggedSet = new Set(Array.isArray(aiDiag.flaggedKeys) ? aiDiag.flaggedKeys : []);
      const disagreedSet = new Set(Array.isArray(aiDiag.disagreedKeys) ? aiDiag.disagreedKeys : []);
      const confidence = aiDiag.confidence ?? {};
      // Evidence-crop regions: the model's blank-sheet calibration knows where each field's
      // box sits on the sheet (SETUP_UPLOAD_NORTH_STAR.md Stage 2A). Groups use the union
      // bounding box of their option checkboxes.
      const regionByKey = new Map<string, { xPct: number; yPct: number; wPct: number; hPct: number }>();
      if (defaultCalibrationIdForDocModel) {
        const calRow = await prisma.setupSheetCalibration.findUnique({
          where: { id: defaultCalibrationIdForDocModel },
          select: { calibrationDataJson: true },
        });
        const imageCal = calRow
          ? normalizeCalibrationData(calRow.calibrationDataJson).imageCalibration
          : undefined;
        if (imageCal) {
          aiReviewSheetAspect = imageCal.reference.widthPx / Math.max(1, imageCal.reference.heightPx);
          for (const cf of imageCal.fields) {
            if (cf.kind === "text" || cf.kind === "checkbox") {
              regionByKey.set(cf.key, cf.region);
            } else {
              let x0 = 1;
              let y0 = 1;
              let x1 = 0;
              let y1 = 0;
              for (const o of cf.options) {
                x0 = Math.min(x0, o.region.xPct);
                y0 = Math.min(y0, o.region.yPct);
                x1 = Math.max(x1, o.region.xPct + o.region.wPct);
                y1 = Math.max(y1, o.region.yPct + o.region.hPct);
              }
              if (x1 > x0 && y1 > y0) {
                regionByKey.set(cf.key, { xPct: x0, yPct: y0, wPct: x1 - x0, hPct: y1 - y0 });
              }
            }
          }
        }
      }
      aiReviewFields = model.schema.fields
        .filter((f) => f.showInSetupSheet !== false)
        .map((f) => ({
          key: f.key,
          label: f.displayLabel,
          section: f.sectionTitle,
          value: typeof parsed[f.key] === "string" ? (parsed[f.key] as string) : parsed[f.key] != null ? String(parsed[f.key]) : "",
          confidence: typeof confidence[f.key] === "number" ? confidence[f.key] : 1,
          flagged: flaggedSet.has(f.key),
          disagreed: disagreedSet.has(f.key),
          ...(f.groupedOptionLabels?.length ? { options: f.groupedOptionLabels } : {}),
          ...(regionByKey.has(f.key) ? { region: regionByKey.get(f.key)! } : {}),
        }));
    }
  }
  const linkedCalibrationFields = doc.calibrationProfileId
    ? (() => {
        const cal = calibrations.find((c) => c.id === doc.calibrationProfileId);
        if (!cal) return 0;
        return normalizeCalibrationData(cal.calibrationDataJson).imageCalibration?.fields.length ?? 0;
      })()
    : 0;
  const showImageCalibrateCta = isImage && linkedCalibrationFields === 0;
  const isAdmin = isAuthAdminEmail(user.email);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Review setup</h1>
          <p className="page-subtitle">Check the imported values look right.</p>
        </div>
      </header>
      {showImageCalibrateCta && !aiReviewFields ? (
        <div className="page-body pb-0">
          {isAdmin ? (
            <CardPanel contentClassName="p-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs">
                <div className="font-medium text-foreground">Calibrate this sheet style (admin)</div>
                <div className="text-muted-foreground">
                  This image has no calibration yet — map its boxes once and every future upload of
                  this template imports automatically.
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {doc.setupSheetModelId ? (
                  <Link
                    href={`/setup-sheet-models/${doc.setupSheetModelId}`}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    Model workbench
                  </Link>
                ) : null}
                <Link
                  href={`/setup-documents/${doc.id}/calibrate-image`}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                >
                  Open box editor
                </Link>
              </div>
            </CardPanel>
          ) : (
            <CardPanel contentClassName="p-3">
              <div className="text-xs">
                <div className="font-medium text-foreground">
                  This sheet style isn’t readable automatically yet
                </div>
                <div className="text-muted-foreground">
                  Your sheet is saved{doc.carId ? " to your car" : ""}. Values will import
                  automatically once this sheet style is supported — no action needed.
                </div>
              </div>
            </CardPanel>
          )}
        </div>
      ) : null}
      {chassisCandidates && chassisCandidates.length > 0 ? (
        <ChassisDisambiguationPrompt docId={doc.id} candidates={chassisCandidates} />
      ) : null}
      {unrecognisedSheet ? (
        <UnrecognisedSheetPrompt
          docId={doc.id}
          message={unrecognisedSheetMessage({
            presence: unrecognisedSheet,
            calibrationName: effectiveCalibrationName,
          })}
          suggestedName={suggestedSheetName}
          storagePath={doc.storagePath}
          originalFilename={doc.originalFilename ?? "sheet.pdf"}
          mimeType={doc.mimeType ?? "application/pdf"}
        />
      ) : null}
      <AutoRefreshWhileProcessing
        active={doc.importStatus === "PENDING" || doc.importStatus === "PROCESSING"}
      />
      {aiReviewFields ? (
        <AiExtractionReviewPanel
          docId={doc.id}
          previewUrl={`/api/setup-documents/${doc.id}/file`}
          fields={aiReviewFields}
          createdSetupId={doc.createdSetupId}
          sheetAspect={aiReviewSheetAspect}
        />
      ) : null}
      <SetupDocumentReviewClient
        doc={{
          ...doc,
          createdAt: doc.createdAt.toISOString(),
          updatedAt: doc.updatedAt.toISOString(),
          parsedAt: doc.parsedAt ? doc.parsedAt.toISOString() : null,
          parseStartedAt: doc.parseStartedAt ? doc.parseStartedAt.toISOString() : null,
          parseFinishedAt: doc.parseFinishedAt ? doc.parseFinishedAt.toISOString() : null,
          effectiveCalibration,
          setupSheetModelSlug: doc.setupSheetModel?.slug ?? null,
        }}
        cars={cars}
        calibrations={calibrations.map((c) => ({
          ...c,
          createdAt: c.createdAt.toISOString(),
          setupSheetModelName: c.setupSheetModel?.name ?? null,
        }))}
        reviewSetupTemplate={reviewSetupTemplate}
        docSetupSheetModelName={docSetupSheetModelName}
        docCarName={linkedCar?.name ?? null}
        defaultCalibrationIdForDocModel={defaultCalibrationIdForDocModel}
      />
    </>
  );
}

