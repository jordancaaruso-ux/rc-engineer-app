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
} from "@/lib/setupCalibrations/types";

type AnchorInput = { xPct: number; yPct: number; wPct: number; hPct: number };

type Body = {
  /** When provided, updates this calibration in-place; otherwise a new one is created. */
  calibrationId?: string | null;
  name?: string;
  exampleDocumentId?: string;
  fields?: unknown[];
  anchors?: AnchorInput[];
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

  const fieldsRaw = Array.isArray(body.fields) ? body.fields : [];
  const fields: ImageCalibrationField[] = [];
  for (const raw of fieldsRaw) {
    const norm = normalizeImageCalibrationField(raw);
    if (norm) fields.push(norm);
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
      pHash64: fingerprint.pHash64,
      headerTokens: fingerprint.headerTokens,
      anchors: anchors.length ? anchors : undefined,
    },
    fields,
  };

  const calibrationId = body.calibrationId?.trim() || null;
  if (calibrationId) {
    const existing = await prisma.setupSheetCalibration.findFirst({
      where: { id: calibrationId, userId: user.id },
      select: { id: true, calibrationDataJson: true, name: true },
    });
    if (!existing) return NextResponse.json({ error: "Calibration not found" }, { status: 404 });
    const merged = normalizeCalibrationData(existing.calibrationDataJson);
    merged.imageCalibration = imageCalibration;
    merged.templateType = "image_region_v1";
    const nextName = body.name?.trim() || existing.name;
    await prisma.setupSheetCalibration.update({
      where: { id: calibrationId },
      data: {
        name: nextName,
        sourceType: "awesomatix_image_v1",
        calibrationDataJson: merged as unknown as object,
        exampleDocumentId,
      },
    });
    return NextResponse.json({
      calibrationId,
      mode: "updated",
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
