import { NextResponse } from "next/server";
import sharp from "sharp";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";

type Ctx = { params: Promise<{ id: string }> };

type Candidate = {
  id: string;
  kind: "checkbox" | "textValue" | "unknown";
  confidence: number;
  region: { xPct: number; yPct: number; wPct: number; hPct: number };
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function overlaps(a: Candidate, b: Candidate): boolean {
  const ax2 = a.region.xPct + a.region.wPct;
  const ay2 = a.region.yPct + a.region.hPct;
  const bx2 = b.region.xPct + b.region.wPct;
  const by2 = b.region.yPct + b.region.hPct;
  return !(ax2 < b.region.xPct || bx2 < a.region.xPct || ay2 < b.region.yPct || by2 < a.region.yPct);
}

function overlapAreaRatio(a: Candidate, b: Candidate): number {
  if (!overlaps(a, b)) return 0;
  const x1 = Math.max(a.region.xPct, b.region.xPct);
  const y1 = Math.max(a.region.yPct, b.region.yPct);
  const x2 = Math.min(a.region.xPct + a.region.wPct, b.region.xPct + b.region.wPct);
  const y2 = Math.min(a.region.yPct + a.region.hPct, b.region.yPct + b.region.hPct);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const smaller = Math.min(a.region.wPct * a.region.hPct, b.region.wPct * b.region.hPct);
  return smaller > 0 ? intersection / smaller : 0;
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const out: Candidate[] = [];
  for (const c of sorted) {
    if (out.some((existing) => overlapAreaRatio(existing, c) > 0.6)) continue;
    out.push(c);
  }
  return out
    .sort((a, b) => (a.region.yPct === b.region.yPct ? a.region.xPct - b.region.xPct : a.region.yPct - b.region.yPct))
    .slice(0, 350)
    .map((c, i) => ({ ...c, id: `r${i + 1}` }));
}

async function detectRegions(bytes: Buffer): Promise<{ widthPx: number; heightPx: number; candidates: Candidate[] }> {
  const meta = await sharp(bytes).metadata();
  const originalWidth = meta.width ?? 0;
  const originalHeight = meta.height ?? 0;
  if (originalWidth <= 0 || originalHeight <= 0) throw new Error("Could not read image dimensions");

  const sampleWidth = Math.min(1100, originalWidth);
  const sampleHeight = Math.max(1, Math.round(sampleWidth * originalHeight / originalWidth));
  const { data, info } = await sharp(bytes)
    .removeAlpha()
    .resize(sampleWidth, sampleHeight, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const channels = info.channels;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const p = i * channels;
    const r = data[p] ?? 0;
    const g = data[p + 1] ?? r;
    const b = data[p + 2] ?? r;
    const dark = r < 95 && g < 95 && b < 95;
    const redInk = r > 130 && g < 95 && b < 95 && r - Math.max(g, b) > 45;
    if (dark || redInk) mask[i] = 1;
  }

  const seen = new Uint8Array(width * height);
  const candidates: Candidate[] = [];
  const queue: number[] = [];
  const dirs = [1, -1, width, -width];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    seen[start] = 1;
    queue.length = 0;
    queue.push(start);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let count = 0;
    for (let qi = 0; qi < queue.length; qi++) {
      const idx = queue[qi]!;
      const x = idx % width;
      const y = Math.floor(idx / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      count++;
      for (const d of dirs) {
        const next = idx + d;
        if (next < 0 || next >= mask.length || seen[next] || !mask[next]) continue;
        if ((d === 1 && x === width - 1) || (d === -1 && x === 0)) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }

    const boxW = maxX - minX + 1;
    const boxH = maxY - minY + 1;
    if (boxW < 5 || boxH < 5) continue;
    if (boxW > width * 0.35 || boxH > height * 0.18) continue;
    const area = boxW * boxH;
    const fill = count / area;
    const aspect = boxW / Math.max(1, boxH);
    const squareish = aspect >= 0.65 && aspect <= 1.55;
    const small = boxW <= 42 && boxH <= 42;
    const textish = aspect >= 1.4 && boxW >= 18 && boxH <= 45;
    if (!small && !textish) continue;
    if (fill > 0.85) continue;

    const pad = small ? 2 : 3;
    const x1 = Math.max(0, minX - pad);
    const y1 = Math.max(0, minY - pad);
    const x2 = Math.min(width, maxX + 1 + pad);
    const y2 = Math.min(height, maxY + 1 + pad);
    const kind: Candidate["kind"] = squareish && small ? "checkbox" : textish ? "textValue" : "unknown";
    candidates.push({
      id: "",
      kind,
      confidence: kind === "checkbox" ? 0.8 : 0.65,
      region: {
        xPct: clamp01(x1 / width),
        yPct: clamp01(y1 / height),
        wPct: clamp01((x2 - x1) / width),
        hPct: clamp01((y2 - y1) / height),
      },
    });
  }

  return { widthPx: originalWidth, heightPx: originalHeight, candidates: dedupeCandidates(candidates) };
}

export async function GET(_request: Request, ctx: Ctx): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const doc = await prisma.setupDocument.findFirst({
    where: { id, userId: user.id },
    select: { storagePath: true, mimeType: true, sourceType: true },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (doc.sourceType !== "IMAGE" && !(doc.mimeType ?? "").startsWith("image/")) {
    return NextResponse.json({ error: "Image document required" }, { status: 400 });
  }
  const bytes = await readBytesFromStorageRef(doc.storagePath);
  const result = await detectRegions(bytes);
  return NextResponse.json(result);
}
