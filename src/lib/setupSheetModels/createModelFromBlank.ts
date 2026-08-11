import "server-only";

import { prisma } from "@/lib/prisma";
import { extractPdfFormFields } from "@/lib/setupDocuments/pdfFormFields";
import { readBytesFromStorageRef, storeSetupDocumentFile } from "@/lib/setupDocuments/storage";
import { verifiedAtForNewCalibration } from "@/lib/setupCalibrations/calibrationAccess";
import { normalizeSetupSheetModelName } from "@/lib/setupSheetModels/normalizeModelName";
import { slugifySetupSheetModelName, uniqueSlugCandidate } from "@/lib/setupSheetModels/slug";
import { deriveSchemaFromAcroForm, type DerivedSheet } from "@/lib/setupSheetModels/deriveSchemaFromAcroForm";
import {
  derivedSheetFingerprint,
  derivedSheetSlug,
} from "@/lib/setupSheetModels/derivedSheetFingerprint";
import { readDerivedSheetValues } from "@/lib/setupSheetModels/readDerivedSheetValues";
import { prerenderSheetPages } from "@/lib/setupSheetModels/sheetPageImages";
import type { SetupSnapshotData } from "@/lib/runSetup";
import {
  refusalForBlankExtraction,
  refusalForBlankFile,
  type BlankRefusal,
} from "@/lib/setupSheetModels/blankUploadDiagnosis";

/**
 * Turn a blank manufacturer setup sheet into a chassis. The only writer for both doors into that.
 *
 * Two modes, one body:
 *
 *   derive: true   the driver's door. The parameter list is read off the PDF's form layer, so the
 *                  chassis is usable the moment it is created — every box on their sheet is there,
 *                  labelled by position where the manufacturer named nothing. Whatever the file
 *                  already holds comes back with it, as values.
 *   derive: false  the founder's door. An empty schema plus an empty calibration, and every
 *                  parameter comes into existence by hand in the mapping editor. Slower, exact,
 *                  and the right tool when he is authoring the curated version of a sheet.
 *
 * ======================== WHY THERE IS NO SEPARATE "BLANK" DOOR ========================
 *
 * Because nothing can tell a blank sheet from a finished one, and pretending otherwise would make
 * the app wrong about a driver's own setup. Measured on the repo fixtures 2026-08-10: Mugen's own
 * blank carries 79 values, because those are the kit settings. Sören's finished copy carries 95.
 * Xray's blank carries 45 that all read "all off". The ranges overlap completely.
 *
 * So this reads the sheet and hands back whatever was in it, and lets the driver look. A finished
 * sheet arrives finished. A manufacturer's blank arrives holding the kit settings, which is a
 * better start than an empty sheet. A truly empty one arrives empty. No guess is made anywhere.
 *
 * They share this function rather than each keeping a copy, because the parts that are easy to get
 * subtly wrong — unique slugs, the calibration link both ways, what is kept when an upload is
 * refused — are the parts that are identical.
 *
 * ============================== ON REFUSING WITHOUT LOSING ==============================
 *
 * A file that could plausibly have been somebody's real setup sheet is STORED even when it cannot
 * be used: the founder needs it to make the sheet fillable himself, and the driver should not have
 * to find the file again. A file that was never a setup sheet — the wrong pick, a photo, a 40-page
 * manual — is refused before anything is written, because keeping it only fills the queue with
 * things nobody will act on. `BlankRefusal.status` is what separates the two.
 *
 * ============================== WHEN TWO UPLOADS ARE ONE CHASSIS ==============================
 *
 * Founder call 2026-08-11, reconciling two designs that had grown up in parallel.
 *
 * Sameness is decided by `derivedSheetFingerprint`, which hashes what the derivation PRODUCED — the
 * keys, in order, and where each reads from. So two drivers who download the same manufacturer
 * sheet land on ONE row, and any difference at all mints a fresh one. That is a proof, not a guess:
 * equal fingerprints mean the two derivations are interchangeable for every purpose downstream.
 *
 * Everything else stays as the driver-facing decisions had it. The driver types the chassis name,
 * and that name labels the row. The row appears in everyone's Add-car dropdown, badged Unreviewed.
 * Two sheets that merely SHARE A NAME are still two chassis, because a name is not evidence.
 *
 * The first uploader's name wins on a merge, and the second driver's spelling is not kept anywhere.
 * A shared row cannot hold two names, and renaming it under the drivers already using it is worse
 * than one of them seeing a spelling they did not choose. They are told which name they joined, so
 * it is a visible outcome rather than a silent one.
 */

export type BlankUploadSource =
  | { kind: "file"; file: File }
  /** Already streamed to Blob by the browser, because it was over the serverless body limit. */
  | { kind: "stored"; storagePath: string; originalFilename: string; mimeType: string; byteSize: number };

export type CreateModelFromBlankInput = {
  user: { id: string; email: string | null };
  /** What the driver typed. Never derived from the PDF — duplicates are allowed on purpose. */
  name: string;
  upload: BlankUploadSource;
  derive: boolean;
  source: "driver" | "admin";
};

export type CreateModelFromBlankResult =
  | {
      ok: true;
      model: { id: string; name: string; slug: string };
      calibrationId: string | null;
      blankId: string | null;
      stats: DerivedSheet["stats"] | null;
      /** True when this exact sheet was already in the catalog and the driver joined that row. */
      merged: boolean;
      /**
       * What the file already had in its boxes, keyed by this sheet's own keys.
       *
       * Present whether the driver uploaded a finished sheet or a manufacturer's blank, because
       * those are not distinguishable and both are worth keeping. Empty boxes are absent rather
       * than blank, so an unfinished sheet does not look like a sheet full of deliberate blanks.
       */
      values: SetupSnapshotData;
      /** How many boxes came with something in them — what the driver is told. */
      filledCount: number;
    }
  | { ok: false; refusal: BlankRefusal; blankId: string | null };

function byteSizeOf(upload: BlankUploadSource): number {
  return upload.kind === "file" ? upload.file.size : upload.byteSize;
}

function mimeTypeOf(upload: BlankUploadSource): string {
  return (upload.kind === "file" ? upload.file.type : upload.mimeType) || "application/pdf";
}

async function bytesOf(upload: BlankUploadSource): Promise<Buffer> {
  if (upload.kind === "stored") return readBytesFromStorageRef(upload.storagePath);
  return Buffer.from(await upload.file.arrayBuffer());
}

/** The empty schema the founder's by-hand door starts from. */
function emptySchema(name: string) {
  return { version: 1, label: name, structuredSections: [], fields: [] };
}

export async function createModelFromBlank(
  input: CreateModelFromBlankInput
): Promise<CreateModelFromBlankResult> {
  const name = input.name.trim();

  const fileRefusal = refusalForBlankFile({
    byteSize: byteSizeOf(input.upload),
    mimeType: mimeTypeOf(input.upload),
  });
  if (fileRefusal) return { ok: false, refusal: fileRefusal, blankId: null };

  // Read and inspect BEFORE storing, so a file that is refused outright never reaches the bucket.
  let derived: DerivedSheet | null = null;
  let pageCount = 1;
  let refusal: BlankRefusal | null = null;
  let values: SetupSnapshotData = {};
  let filledCount = 0;

  if (input.derive) {
    const extraction = await extractPdfFormFields(await bytesOf(input.upload));
    pageCount = extraction.pageCount ?? 1;
    // Derivation is total and cheap, and the box count is itself one of the refusal tests — a form
    // layer whose widgets all sit off-page reads as "has fields" and produces nothing to fill.
    const candidate = deriveSchemaFromAcroForm(extraction, name);
    refusal = refusalForBlankExtraction({ extraction, boxCount: candidate.boxes.length });
    // A refusal we do not want in the queue is a wrong pick: say so and keep nothing.
    if (refusal && refusal.status === null) return { ok: false, refusal, blankId: null };
    if (!refusal) {
      derived = candidate;
      // Read from the same derivation that produced the sheet, so every key here is one the
      // driver's sheet declares. Deliberately NOT the ordinary import path: that one finishes
      // values through `rewriteImportedCalculatedDisplayKey`, which hard-codes `text91` and
      // `text93` to mean Awesomatix spring rates — and a Mugen sheet's keys live in exactly that
      // namespace, so a driver's box 91 would vanish and reappear meaning something else.
      ({ values, filledCount } = readDerivedSheetValues({
        extraction,
        formFieldMappings: candidate.formFieldMappings,
      }));
    }
  }

  // The sheet is already in the catalog: join that row rather than minting a second one. Checked
  // before storage on purpose — a merge should not leave a second copy of the same PDF behind.
  const fingerprintSlug = derived ? derivedSheetSlug(derivedSheetFingerprint(derived)) : null;
  if (fingerprintSlug && derived) {
    const existing = await prisma.setupSheetModel.findUnique({
      where: { slug: fingerprintSlug },
      select: { id: true, name: true, slug: true, defaultCalibrationId: true },
    });
    if (existing) {
      return {
        ok: true,
        model: { id: existing.id, name: existing.name, slug: existing.slug },
        calibrationId: existing.defaultCalibrationId,
        blankId: null,
        stats: derived.stats,
        merged: true,
        // The chassis is shared; the values in THIS driver's file are theirs alone and come back
        // regardless of whose row they landed on.
        values,
        filledCount,
      };
    }
  }

  const storagePath =
    input.upload.kind === "stored"
      ? input.upload.storagePath
      : (await storeSetupDocumentFile(input.upload.file)).storagePath;

  const document = await prisma.setupDocument.create({
    data: {
      originalFilename: `BLANK - ${name}`,
      storagePath,
      mimeType: "application/pdf",
      sourceType: "PDF",
      parseStatus: "PENDING",
      importStatus: "COMPLETED",
      userId: input.user.id,
    },
    select: { id: true },
  });

  const normalizedName = normalizeSetupSheetModelName(name);

  // The upload is on the record either way. On a refusal that is the whole point: the file is
  // waiting for the founder with the name the driver gave it.
  if (refusal) {
    const blank = await prisma.setupSheetBlank.create({
      data: {
        status: refusal.status ?? "NOT_FILLABLE",
        source: input.source,
        setupDocumentId: document.id,
        uploadedByUserId: input.user.id,
        chassisNameTyped: name,
        normalizedName,
        pageCount,
      },
      select: { id: true },
    });
    return { ok: false, refusal, blankId: blank.id };
  }

  /*
   * A derived chassis is keyed by its sheet, not by what it was called.
   *
   * That is what lets the next driver holding the same PDF land here instead of minting a row of
   * their own, and it is why two chassis that merely share a NAME stay separate — the name is the
   * driver's label for the row, never its identity. The founder's by-hand door keeps the readable
   * name slug, because there the name IS the curated identity.
   */
  let slug = fingerprintSlug;
  if (!slug) {
    const existingSlugs = await prisma.setupSheetModel.findMany({ select: { slug: true } });
    slug = uniqueSlugCandidate(
      slugifySetupSheetModelName(name),
      new Set(existingSlugs.map((r) => r.slug))
    );
  }

  const model = await prisma.setupSheetModel.create({
    data: {
      userId: input.user.id,
      name,
      slug,
      // Left unauthorized: the picker badges it "Unreviewed", and community aggregation excludes
      // every car on it until the founder verifies. That gate is deliberate — see
      // `rebuildCommunityTemplateAggregations`.
      schemaJson: (derived ? derived.schema : emptySchema(name)) as object,
    },
    select: { id: true, name: true, slug: true },
  });

  const calibration = await prisma.setupSheetCalibration.create({
    data: {
      userId: input.user.id,
      name: `${name} calibration`,
      sourceType: "pdf",
      calibrationDataJson: {
        templateType: "pdf_form_fields",
        documentMeta: { lineGroupingEpsilon: 2.5 },
        formFieldMappings: (derived?.formFieldMappings ?? {}) as object,
        fieldMappings: {},
        fields: {},
      } as object,
      exampleDocumentId: document.id,
      setupSheetModelId: model.id,
      verifiedAt: verifiedAtForNewCalibration(input.user),
    },
    select: { id: true },
  });

  await prisma.setupSheetModel.update({
    where: { id: model.id },
    data: { defaultCalibrationId: calibration.id },
  });
  await prisma.setupDocument.update({
    where: { id: document.id },
    data: { setupSheetModelId: model.id, calibrationProfileId: calibration.id },
  });

  // The geometry lives here rather than being re-read from the PDF on demand. The chassis is
  // global, so the sheet has to keep drawing for everyone else even after the uploader deletes
  // their account and the `SetupDocument` cascade takes their file with it.
  const blank = await prisma.setupSheetBlank.create({
    data: {
      status: "FILLABLE",
      source: input.source,
      setupSheetModelId: model.id,
      setupDocumentId: document.id,
      uploadedByUserId: input.user.id,
      chassisNameTyped: name,
      normalizedName,
      pageCount,
      boxesJson: (derived?.boxes ?? []) as object,
      statsJson: (derived?.stats ?? null) as object | undefined,
      // A sheet with no derived geometry has nothing to draw, so it fills as an ordinary form.
      fillSurface: derived && derived.boxes.length > 0 ? "sheet" : "form",
    },
    select: { id: true },
  });

  /*
   * Draw the sheet now, while the driver is still watching an upload they know is working.
   *
   * Left to the first open, this cost lands on somebody opening their brand-new car — and what they
   * see meanwhile is empty paper, which reads as a broken sheet. See `prerenderSheetPages`; it
   * never throws, so a chassis whose picture would not draw is still created.
   */
  await prerenderSheetPages(model.id);

  return {
    ok: true,
    model,
    calibrationId: calibration.id,
    blankId: blank.id,
    stats: derived?.stats ?? null,
    merged: false,
    values,
    filledCount,
  };
}
