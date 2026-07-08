import { NextResponse } from "next/server";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  calibrationReadableByIdWhere,
  canManageCalibration,
} from "@/lib/setupCalibrations/calibrationAccess";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";
import { extractPdfFormFields } from "@/lib/setupDocuments/pdfFormFields";
import { deriveImageFieldsFromPdfMappings } from "@/lib/setupCalibrations/deriveImageFieldsFromPdfMappings";
import { fingerprintImageBytes } from "@/lib/setupCalibrations/imageFingerprint";
import {
  diffImageCalibrationFieldKeys,
  normalizeCalibrationData,
  type ImageCalibration,
} from "@/lib/setupCalibrations/types";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * One-click "derive image map" for an AcroForm calibration that already has field mappings.
 * The client renders the calibration's example PDF to a PNG and posts it; we derive image
 * regions deterministically from the existing `formFieldMappings` widget geometry (no AI, no
 * screenshot upload), fingerprint the render as the reference, and write the `imageCalibration`
 * lane onto the same calibration row. Lets already-calibrated AcroForms accept image/photo
 * uploads without redoing any work.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const calibration = await prisma.setupSheetCalibration.findFirst({
    where: calibrationReadableByIdWhere(id),
    select: {
      id: true,
      name: true,
      userId: true,
      calibrationDataJson: true,
      exampleDocumentId: true,
      exampleDocument: { select: { id: true, storagePath: true, mimeType: true } },
    },
  });
  if (!calibration) return NextResponse.json({ error: "Calibration not found" }, { status: 404 });
  if (!canManageCalibration(user, calibration)) {
    return NextResponse.json({ error: "You can only edit calibrations you created." }, { status: 403 });
  }
  if (!calibration.exampleDocument || calibration.exampleDocument.mimeType !== "application/pdf") {
    return NextResponse.json(
      { error: "This calibration needs an editable PDF example document to derive an image map." },
      { status: 400 }
    );
  }

  // Rendered PNG of the PDF page (produced client-side) becomes the reference image.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data (png)." }, { status: 400 });
  }
  const png = form.get("png");
  if (!(png instanceof File)) {
    return NextResponse.json({ error: "The rendered page image (png) is required." }, { status: 400 });
  }

  let pdfBytes: Buffer;
  try {
    pdfBytes = await readBytesFromStorageRef(calibration.exampleDocument.storagePath);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to read the example PDF." },
      { status: 500 }
    );
  }

  const extracted = await extractPdfFormFields(pdfBytes);
  if (!extracted.hasFormFields) {
    return NextResponse.json(
      { error: extracted.loadError || "The example PDF has no AcroForm fields." },
      { status: 400 }
    );
  }

  const derived = deriveImageFieldsFromPdfMappings({
    calibrationDataJson: calibration.calibrationDataJson,
    extracted,
  });
  if (derived.fields.length === 0) {
    return NextResponse.json(
      {
        error: "No image fields could be derived — map this AcroForm's fields to parameters first.",
        warnings: derived.warnings,
      },
      { status: 400 }
    );
  }

  const imageBytes = Buffer.from(await png.arrayBuffer());
  let fingerprint: Awaited<ReturnType<typeof fingerprintImageBytes>>;
  try {
    fingerprint = await fingerprintImageBytes(new Uint8Array(imageBytes));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fingerprint the rendered page." },
      { status: 500 }
    );
  }
  if (fingerprint.widthPx <= 0 || fingerprint.heightPx <= 0) {
    return NextResponse.json({ error: "Could not read the rendered page dimensions." }, { status: 400 });
  }

  const imageCalibration: ImageCalibration = {
    reference: {
      exampleDocumentId: calibration.exampleDocumentId ?? "",
      widthPx: fingerprint.widthPx,
      heightPx: fingerprint.heightPx,
      // Full page: derived field regions are relative to the whole PDF page. Setting pageRegion
      // (rather than leaving it undefined) makes the extract pipeline detect the sheet's white
      // boundary in each upload and crop to it before applying regions — so screenshots/photos
      // whose borders or margins differ from the PDF still align. See extractImageRawDataFromFile.
      pageRegion: { xPct: 0, yPct: 0, wPct: 1, hPct: 1 },
      pHash64: fingerprint.pHash64,
      headerTokens: fingerprint.headerTokens,
    },
    fields: derived.fields,
  };

  const merged = normalizeCalibrationData(calibration.calibrationDataJson);
  // Geometry edits after green-light invalidate just the affected fields (the calibration stays
  // verified/live) — mirror the calibrate-image derive behaviour.
  if (merged.verification?.greenLitAt) {
    const changedKeys = diffImageCalibrationFieldKeys(merged.imageCalibration, imageCalibration);
    if (changedKeys.length) {
      merged.verification.fieldsNeedingRecheck = [
        ...new Set([...(merged.verification.fieldsNeedingRecheck ?? []), ...changedKeys]),
      ];
    }
  }
  merged.imageCalibration = imageCalibration;

  await prisma.setupSheetCalibration.update({
    where: { id: calibration.id },
    data: { calibrationDataJson: merged as unknown as object },
  });

  return NextResponse.json({
    ok: true,
    derivedFields: derived.fields.length,
    warnings: derived.warnings.length ? derived.warnings : undefined,
  });
}
