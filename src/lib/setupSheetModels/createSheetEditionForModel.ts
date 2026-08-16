import "server-only";

import { prisma } from "@/lib/prisma";
import type { PdfFormFieldsExtraction } from "@/lib/setupDocuments/pdfFormFields";
import { verifiedAtForNewCalibration } from "@/lib/setupCalibrations/calibrationAccess";
import { normalizeSetupSheetModelName } from "@/lib/setupSheetModels/normalizeModelName";
import { deriveSchemaFromAcroForm } from "@/lib/setupSheetModels/deriveSchemaFromAcroForm";
import { derivedSheetFingerprint } from "@/lib/setupSheetModels/derivedSheetFingerprint";
import { refusalForBlankExtraction } from "@/lib/setupSheetModels/blankUploadDiagnosis";
import { prerenderSheetPages } from "@/lib/setupSheetModels/sheetPageImages";

/**
 * A rebuilt copy of a sheet the app already knows, learned silently at upload.
 *
 * ============================== THE FAILURE THIS ENDS ==============================
 *
 * A chassis's identity used to be its calibration's box-name vocabulary — one vocabulary per
 * chassis. The moment anyone republishes the fillable PDF with renamed boxes (manufacturers do
 * this; so do fast drivers sharing "improved" sheets), every rule misses and the upload dead-ends
 * at "pick a calibration" over a table of dashes. Measured 2026-08-16 on a driver's A800RR sheet:
 * 2 of the calibration's 134 box names existed in his file. Same car, same printed layout,
 * different vocabulary — and the app's answer was a form that filled in nothing.
 *
 * ============================== WHAT AN EDITION IS ==============================
 *
 * The derive-from-form-layer door (`createModelFromBlank`) already turns exactly such a file into
 * a working sheet — every box fillable, keys minted from the file's own field names, no human
 * understanding required. Its one flaw for this case was the exit: it minted a NEW chassis, which
 * splits the driver's runs across two cars that are one car. An edition is the same derivation
 * landed UNDER the existing chassis:
 *
 *   - a `SetupSheetCalibration` whose mappings read every box, so the ordinary fingerprint pick
 *     recognises the next upload of this layout and the ordinary import pipeline reads it;
 *   - a `SetupSheetBlank` with `isEdition: true` carrying the boxes, its own field list
 *     (`schemaFieldsJson`) and its own page images, so the sheet draws as this file, not as the
 *     primary blank the keys don't match.
 *
 * The model's `schemaJson` is deliberately NOT touched. Edition keys mean nothing to the Engineer,
 * the aggregations or the geometry strip until a human aliases them — that split (using a sheet
 * needs no names, understanding does) is the standing ruling of 2026-08-11, and pushing ~200
 * minted keys into a curated schema would put nonsense rows in every driver's analysis screens.
 *
 * ============================== EDITIONS ARE GLOBAL ==============================
 *
 * Founder call 2026-08-16: like chassis and calibrations, an edition minted by one driver serves
 * everyone holding that file. Deduplication is by `derivedSheetFingerprint` — the same proof
 * `createModelFromBlank` uses to land two drivers' identical uploads on one chassis row. A second
 * driver's upload of the same rebuilt PDF re-derives, hashes equal, and joins the existing
 * edition instead of minting a twin. (Their upload reaches this module at all because the
 * fingerprint PICK only auto-applies another user's calibration once it is founder-verified —
 * so until then the edition is re-recognised here, by the same measurement that created it.)
 */

export type CreateSheetEditionResult =
  | {
      ok: true;
      calibrationId: string;
      blankId: string;
      /** False when this exact layout already existed as an edition and was joined, not minted. */
      created: boolean;
      /** Parameters on the edition, for the log line and the pick note. */
      boxCount: number;
    }
  | { ok: false; reason: string };

export async function createSheetEditionForModel(input: {
  user: { id: string; email: string | null };
  model: { id: string; name: string };
  /** The uploaded file's form layer, already extracted by the caller's fillable-PDF gate. */
  extraction: PdfFormFieldsExtraction;
  /** The uploaded `SetupDocument` — becomes the edition's example document and blank source. */
  documentId: string;
  originalFilename: string;
}): Promise<CreateSheetEditionResult> {
  const derived = deriveSchemaFromAcroForm(input.extraction, input.model.name);
  const refusal = refusalForBlankExtraction({
    extraction: input.extraction,
    boxCount: derived.boxes.length,
  });
  if (refusal) return { ok: false, reason: refusal.code };

  const fingerprint = derivedSheetFingerprint(derived);

  // The same layout already lives under this chassis: join it. The existing edition's calibration
  // is found through its example document, which is also the blank's source PDF.
  const existing = await prisma.setupSheetBlank.findFirst({
    where: {
      setupSheetModelId: input.model.id,
      isEdition: true,
      fingerprint,
      setupDocumentId: { not: null },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, setupDocumentId: true },
  });
  if (existing?.setupDocumentId) {
    const calibration = await prisma.setupSheetCalibration.findFirst({
      where: { setupSheetModelId: input.model.id, exampleDocumentId: existing.setupDocumentId },
      select: { id: true },
    });
    if (calibration) {
      return {
        ok: true,
        calibrationId: calibration.id,
        blankId: existing.id,
        created: false,
        boxCount: derived.boxes.length,
      };
    }
  }

  const calibration = await prisma.setupSheetCalibration.create({
    data: {
      userId: input.user.id,
      // Named for the review screen's calibration list: which chassis, and which file's layout.
      name: `${input.model.name} — ${input.originalFilename} layout`,
      sourceType: "pdf",
      calibrationDataJson: {
        templateType: "pdf_form_fields",
        documentMeta: { lineGroupingEpsilon: 2.5 },
        formFieldMappings: derived.formFieldMappings as object,
        fieldMappings: {},
        fields: {},
      } as object,
      exampleDocumentId: input.documentId,
      setupSheetModelId: input.model.id,
      // NOT the model default — the primary sheet keeps that. Verification keeps its usual rule.
      verifiedAt: verifiedAtForNewCalibration(input.user),
    },
    select: { id: true },
  });

  const blank = await prisma.setupSheetBlank.create({
    data: {
      status: "FILLABLE",
      source: "driver",
      isEdition: true,
      fingerprint,
      setupSheetModelId: input.model.id,
      setupDocumentId: input.documentId,
      uploadedByUserId: input.user.id,
      chassisNameTyped: input.model.name,
      normalizedName: normalizeSetupSheetModelName(input.model.name),
      pageCount: input.extraction.pageCount ?? 1,
      boxesJson: derived.boxes as unknown as object,
      statsJson: derived.stats as unknown as object,
      schemaFieldsJson: derived.schema.fields as unknown as object,
      fillSurface: "sheet",
    },
    select: { id: true },
  });

  // Draw the edition's pages now, while the driver is watching an upload that says "Reading
  // sheet…" — same argument as `createModelFromBlank`. Never throws.
  await prerenderSheetPages(input.model.id, blank.id);

  console.log(
    `[sheet-edition] model=${input.model.id} blank=${blank.id} calibration=${calibration.id} boxes=${derived.boxes.length} fingerprint=${fingerprint} file=${input.originalFilename}`
  );

  return {
    ok: true,
    calibrationId: calibration.id,
    blankId: blank.id,
    created: true,
    boxCount: derived.boxes.length,
  };
}
