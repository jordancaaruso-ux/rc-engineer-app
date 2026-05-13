import { NextResponse } from "next/server";
import sharp from "sharp";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";
import {
  fingerprintImageBytes,
  hammingDistanceHex,
} from "@/lib/setupCalibrations/imageFingerprint";
import {
  normalizeCalibrationData,
  normalizeImageCalibrationField,
  type ImageCalibration,
  type ImageCalibrationAnchor,
  type ImageCalibrationField,
  type ImageRegion,
  type PdfFormFieldMappingRule,
} from "@/lib/setupCalibrations/types";
import {
  getCalibrationFieldKind,
} from "@/lib/setupCalibrations/calibrationFieldCatalog";
import {
  extractPdfFormFields,
  type PdfFormFieldsExtraction,
  type PdfFormFieldWidgetRect,
} from "@/lib/setupDocuments/pdfFormFields";

type AnchorInput = { xPct: number; yPct: number; wPct: number; hPct: number };

type Body = {
  /** When provided, updates this calibration in-place; otherwise a new one is created. */
  calibrationId?: string | null;
  /** Optional editable-PDF calibration whose AcroForm widgets should become image regions. */
  deriveFromCalibrationId?: string | null;
  name?: string;
  exampleDocumentId?: string;
  fields?: unknown[];
  anchors?: AnchorInput[];
  pageRegion?: AnchorInput | null;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function regionFromAnchor(input: AnchorInput): ImageRegion {
  return {
    xPct: clamp01(input.xPct),
    yPct: clamp01(input.yPct),
    wPct: clamp01(input.wPct),
    hPct: clamp01(input.hPct),
  };
}

function regionFromPdfWidget(widget: PdfFormFieldWidgetRect, pageRegion?: ImageRegion): ImageRegion | null {
  if (widget.pageNumber !== 1) return null;
  if (widget.pageWidth <= 0 || widget.pageHeight <= 0 || widget.width <= 0 || widget.height <= 0) return null;
  const pageRelative = {
    xPct: clamp01(widget.x / widget.pageWidth),
    yPct: clamp01(widget.y / widget.pageHeight),
    wPct: clamp01(widget.width / widget.pageWidth),
    hPct: clamp01(widget.height / widget.pageHeight),
  };
  if (!pageRegion) return pageRelative;
  return {
    xPct: clamp01(pageRegion.xPct + pageRelative.xPct * pageRegion.wPct),
    yPct: clamp01(pageRegion.yPct + pageRelative.yPct * pageRegion.hPct),
    wPct: clamp01(pageRelative.wPct * pageRegion.wPct),
    hPct: clamp01(pageRelative.hPct * pageRegion.hPct),
  };
}

function findWidget(
  extracted: PdfFormFieldsExtraction,
  pdfFieldName: string,
  widgetInstanceIndex?: number
): PdfFormFieldWidgetRect | null {
  const row = extracted.fields.find((f) => f.name === pdfFieldName);
  if (!row) return null;
  const index = widgetInstanceIndex ?? 0;
  return row.widgets.find((w) => w.instanceIndex === index) ?? row.widgets[index] ?? null;
}

function simpleImageFieldFromRule(input: {
  key: string;
  rule: { pdfFieldName: string; widgetInstanceIndex?: number };
  extracted: PdfFormFieldsExtraction;
  warnings: string[];
  pageRegion?: ImageRegion;
}): ImageCalibrationField | null {
  const widget = findWidget(input.extracted, input.rule.pdfFieldName, input.rule.widgetInstanceIndex);
  if (!widget) {
    input.warnings.push(`missing_widget:${input.key}:${input.rule.pdfFieldName}#${input.rule.widgetInstanceIndex ?? 0}`);
    return null;
  }
  const region = regionFromPdfWidget(widget, input.pageRegion);
  if (!region) {
    input.warnings.push(`unsupported_widget_region:${input.key}:${input.rule.pdfFieldName}#${widget.instanceIndex}`);
    return null;
  }
  const kind = getCalibrationFieldKind(input.key);
  if (kind === "boolean") {
    return { kind: "checkbox", key: input.key, region, checkedValue: "1", uncheckedValue: "" };
  }
  return { kind: "text", key: input.key, region, numericOnly: kind === "number" || undefined };
}

function deriveImageFieldsFromPdfMappings(input: {
  calibrationDataJson: unknown;
  extracted: PdfFormFieldsExtraction;
  pageRegion?: ImageRegion;
}): { fields: ImageCalibrationField[]; warnings: string[] } {
  const calibrationData = normalizeCalibrationData(input.calibrationDataJson);
  const mappings = calibrationData.formFieldMappings ?? {};
  const fields: ImageCalibrationField[] = [];
  const warnings: string[] = [];

  const optionRegion = (key: string, value: string, pdfFieldName: string, widgetInstanceIndex?: number) => {
    const widget = findWidget(input.extracted, pdfFieldName, widgetInstanceIndex);
    if (!widget) {
      warnings.push(`missing_widget:${key}:${value}:${pdfFieldName}#${widgetInstanceIndex ?? 0}`);
      return null;
    }
    const region = regionFromPdfWidget(widget, input.pageRegion);
    if (!region) {
      warnings.push(`unsupported_widget_region:${key}:${value}:${pdfFieldName}#${widget.instanceIndex}`);
      return null;
    }
    return { value, region };
  };

  for (const [key, rule] of Object.entries(mappings)) {
    if ("mode" in rule && rule.mode === "singleChoiceWidgetGroup") {
      const options = Object.entries(rule.options)
        .map(([value, ref]) => optionRegion(key, value, rule.pdfFieldName, ref.widgetInstanceIndex))
        .filter(Boolean) as Array<{ value: string; region: ImageRegion }>;
      if (options.length > 0) fields.push({ kind: "singleChoiceGroup", key, options });
      continue;
    }
    if ("mode" in rule && rule.mode === "multiSelectWidgetGroup") {
      const options = Object.entries(rule.options)
        .map(([value, ref]) => optionRegion(key, value, rule.pdfFieldName, ref.widgetInstanceIndex))
        .filter(Boolean) as Array<{ value: string; region: ImageRegion }>;
      if (options.length > 0) fields.push({ kind: "multiSelectGroup", key, options });
      continue;
    }
    if ("mode" in rule && rule.mode === "singleChoiceNamedFields") {
      const options = Object.entries(rule.options)
        .map(([value, ref]) => optionRegion(key, value, ref.pdfFieldName, ref.widgetInstanceIndex))
        .filter(Boolean) as Array<{ value: string; region: ImageRegion }>;
      if (options.length > 0) fields.push({ kind: "singleChoiceGroup", key, options });
      continue;
    }
    if ("mode" in rule && rule.mode === "multiSelectNamedFields") {
      const options = Object.entries(rule.options)
        .map(([value, ref]) => optionRegion(key, value, ref.pdfFieldName, ref.widgetInstanceIndex))
        .filter(Boolean) as Array<{ value: string; region: ImageRegion }>;
      if (options.length > 0) fields.push({ kind: "multiSelectGroup", key, options });
      continue;
    }

    const simple = simpleImageFieldFromRule({
      key,
      rule: rule as PdfFormFieldMappingRule & { pdfFieldName: string; widgetInstanceIndex?: number },
      extracted: input.extracted,
      warnings,
      pageRegion: input.pageRegion,
    });
    if (simple) fields.push(simple);
  }

  return { fields, warnings };
}

async function dHashHexFromBuffer(buf: Buffer): Promise<string> {
  const { data } = await sharp(buf)
    .removeAlpha()
    .grayscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bits: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = data[y * 9 + x] ?? 0;
      const right = data[y * 9 + x + 1] ?? 0;
      bits.push(left < right ? 1 : 0);
    }
  }
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i]! << 3) | (bits[i + 1]! << 2) | (bits[i + 2]! << 1) | bits[i + 3]!;
    hex += nibble.toString(16);
  }
  return hex;
}

async function computeAnchorPHashes(
  imageBytes: Buffer,
  widthPx: number,
  heightPx: number,
  anchors: AnchorInput[]
): Promise<ImageCalibrationAnchor[]> {
  const out: ImageCalibrationAnchor[] = [];
  for (const a of anchors) {
    const region = regionFromAnchor(a);
    const left = Math.round(region.xPct * widthPx);
    const top = Math.round(region.yPct * heightPx);
    const w = Math.round(region.wPct * widthPx);
    const h = Math.round(region.hPct * heightPx);
    if (w <= 0 || h <= 0 || left < 0 || top < 0 || left + w > widthPx || top + h > heightPx) continue;
    try {
      const crop = await sharp(imageBytes).extract({ left, top, width: w, height: h }).png().toBuffer();
      const pHash = await dHashHexFromBuffer(crop);
      out.push({ ...region, pHash });
    } catch {
      // Skip anchors that fail to crop.
    }
  }
  return out;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const exampleDocumentId = body.exampleDocumentId?.trim() ?? "";
  if (!exampleDocumentId) return NextResponse.json({ error: "exampleDocumentId is required" }, { status: 400 });

  const doc = await prisma.setupDocument.findFirst({
    where: { id: exampleDocumentId, userId: user.id },
    select: { id: true, storagePath: true, mimeType: true, sourceType: true, originalFilename: true },
  });
  if (!doc) return NextResponse.json({ error: "Example document not found" }, { status: 404 });
  if (doc.sourceType !== "IMAGE" && !(doc.mimeType ?? "").startsWith("image/")) {
    return NextResponse.json({ error: "Example document must be an image upload" }, { status: 400 });
  }

  const deriveFromCalibrationId = body.deriveFromCalibrationId?.trim() || null;
  const pageRegion =
    deriveFromCalibrationId && body.pageRegion
      ? regionFromAnchor(body.pageRegion)
      : deriveFromCalibrationId
        ? { xPct: 0, yPct: 0, wPct: 1, hPct: 1 }
        : undefined;
  const fieldsRaw = Array.isArray(body.fields) ? body.fields : [];
  const fields: ImageCalibrationField[] = [];
  for (const raw of fieldsRaw) {
    const norm = normalizeImageCalibrationField(raw);
    if (norm) fields.push(norm);
  }

  let derivedWarnings: string[] = [];
  let targetCalibrationId = body.calibrationId?.trim() || null;
  if (deriveFromCalibrationId) {
    const sourceCalibration = await prisma.setupSheetCalibration.findFirst({
      where: { id: deriveFromCalibrationId, userId: user.id },
      select: {
        id: true,
        calibrationDataJson: true,
        exampleDocument: {
          select: { id: true, storagePath: true, mimeType: true },
        },
      },
    });
    if (!sourceCalibration) {
      return NextResponse.json({ error: "Source PDF calibration not found" }, { status: 404 });
    }
    if (!sourceCalibration.exampleDocument || sourceCalibration.exampleDocument.mimeType !== "application/pdf") {
      return NextResponse.json(
        { error: "Source calibration needs an editable PDF example document" },
        { status: 400 }
      );
    }
    let pdfBytes: Buffer;
    try {
      pdfBytes = await readBytesFromStorageRef(sourceCalibration.exampleDocument.storagePath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to read source PDF";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
    const extractedPdf = await extractPdfFormFields(pdfBytes);
    if (!extractedPdf.hasFormFields) {
      return NextResponse.json(
        { error: extractedPdf.loadError || "Source PDF has no AcroForm fields" },
        { status: 400 }
      );
    }
    const derived = deriveImageFieldsFromPdfMappings({
      calibrationDataJson: sourceCalibration.calibrationDataJson,
      extracted: extractedPdf,
    });
    fields.splice(0, fields.length, ...derived.fields);
    derivedWarnings = derived.warnings;
    targetCalibrationId = targetCalibrationId ?? sourceCalibration.id;
  }

  if (deriveFromCalibrationId && fields.length === 0) {
    return NextResponse.json(
      { error: "No image fields could be derived from the source PDF calibration", warnings: derivedWarnings },
      { status: 400 }
    );
  }

  let imageBytes: Buffer;
  try {
    imageBytes = await readBytesFromStorageRef(doc.storagePath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to read example image";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  let fingerprint: Awaited<ReturnType<typeof fingerprintImageBytes>>;
  try {
    fingerprint = await fingerprintImageBytes(new Uint8Array(imageBytes));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fingerprint example image";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  if (fingerprint.widthPx <= 0 || fingerprint.heightPx <= 0) {
    return NextResponse.json({ error: "Could not read image dimensions" }, { status: 400 });
  }

  const anchorInputs = Array.isArray(body.anchors) ? body.anchors : [];
  const anchors = await computeAnchorPHashes(imageBytes, fingerprint.widthPx, fingerprint.heightPx, anchorInputs);

  const imageCalibration: ImageCalibration = {
    reference: {
      exampleDocumentId,
      widthPx: fingerprint.widthPx,
      heightPx: fingerprint.heightPx,
      pageRegion,
      pHash64: fingerprint.pHash64,
      headerTokens: fingerprint.headerTokens,
      anchors: anchors.length ? anchors : undefined,
    },
    fields,
  };

  const calibrationId = targetCalibrationId;
  if (calibrationId) {
    const existing = await prisma.setupSheetCalibration.findFirst({
      where: { id: calibrationId, userId: user.id },
      select: { id: true, calibrationDataJson: true, name: true },
    });
    if (!existing) return NextResponse.json({ error: "Calibration not found" }, { status: 404 });
    const merged = normalizeCalibrationData(existing.calibrationDataJson);
    merged.imageCalibration = imageCalibration;
    if (!deriveFromCalibrationId) merged.templateType = "image_region_v1";
    const nextName = body.name?.trim() || existing.name;
    const data: {
      name: string;
      calibrationDataJson: object;
      sourceType?: string;
      exampleDocumentId?: string;
    } = {
      name: nextName,
      calibrationDataJson: merged as unknown as object,
    };
    if (!deriveFromCalibrationId) {
      data.sourceType = "awesomatix_image_v1";
      data.exampleDocumentId = exampleDocumentId;
    }
    await prisma.setupSheetCalibration.update({
      where: { id: calibrationId },
      data,
    });
    return NextResponse.json({
      calibrationId,
      mode: "updated",
      derivedFields: deriveFromCalibrationId ? fields.length : undefined,
      warnings: derivedWarnings.length ? derivedWarnings : undefined,
      hammingToReference: hammingDistanceHex(fingerprint.pHash64, imageCalibration.reference.pHash64),
    });
  }

  const name = body.name?.trim() || `Image calibration · ${doc.originalFilename}`;
  const created = await prisma.setupSheetCalibration.create({
    data: {
      userId: user.id,
      name,
      sourceType: "awesomatix_image_v1",
      calibrationDataJson: ({ templateType: "image_region_v1", imageCalibration } as unknown) as object,
      exampleDocumentId,
    },
    select: { id: true },
  });
  return NextResponse.json({ calibrationId: created.id, mode: "created" }, { status: 201 });
}
