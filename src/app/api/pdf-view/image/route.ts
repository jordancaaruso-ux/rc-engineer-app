import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { ensureRenderedRunSetupPdf, ensureRenderedSetupSnapshotPdf } from "@/lib/setup/ensureRunSetupPdf";
import { pdfPageCount, renderPdfPageToPng } from "@/lib/setupDocuments/pdfServerRaster";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";

/**
 * The `/pdf-view` page's picture source: one page of the framed PDF, as a PNG.
 *
 * A phone never gets the PDF itself to look at — iOS clips a framed PDF to a non-scrolling strip
 * (founder screenshot, 2026-09-01), and shipping pdf.js to draw one client-side costs 1.2MB of
 * worker on club wifi. The server already rasterises sheets (`pdfServerRaster`), so the viewer
 * shows pictures and leaves the actual file to its Download button.
 *
 * `?meta=1` answers `{ pages }` so the viewer knows how many pictures to ask for.
 */

const ID_RE = /^[a-z0-9]{16,40}$/i;
/** A "setup sheet" with more pages than this is some other kind of document; the viewer stops. */
const MAX_VIEWER_PAGES = 12;

async function resolvePdfBytes(
  userId: string,
  params: URLSearchParams
): Promise<Buffer | null> {
  const snapshotId = params.get("snapshot")?.trim();
  if (snapshotId && ID_RE.test(snapshotId)) {
    const ensured = await ensureRenderedSetupSnapshotPdf({ userId, setupSnapshotId: snapshotId });
    return ensured?.bytes ?? null;
  }
  const runId = params.get("run")?.trim();
  if (runId && ID_RE.test(runId)) {
    const ensured = await ensureRenderedRunSetupPdf({ userId, runId });
    return ensured?.bytes ?? null;
  }
  const documentId = params.get("document")?.trim();
  if (documentId && ID_RE.test(documentId)) {
    const doc = await prisma.setupDocument.findFirst({
      where: { id: documentId, userId },
      select: { storagePath: true, mimeType: true },
    });
    if (!doc || doc.mimeType !== "application/pdf") return null;
    try {
      return await readBytesFromStorageRef(doc.storagePath);
    } catch {
      return null;
    }
  }
  return null;
}

export async function GET(request: Request): Promise<Response> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const bytes = await resolvePdfBytes(userId, params);
  if (!bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (params.get("meta") === "1") {
    const pages = Math.min(await pdfPageCount(new Uint8Array(bytes)), MAX_VIEWER_PAGES);
    return NextResponse.json({ pages }, { headers: { "Cache-Control": "private, max-age=300" } });
  }

  const page = Math.min(Math.max(Number(params.get("page") ?? "1") || 1, 1), MAX_VIEWER_PAGES);
  try {
    const png = await renderPdfPageToPng(new Uint8Array(bytes), page, { scale: 2 });
    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "Could not draw this page" }, { status: 500 });
  }
}
