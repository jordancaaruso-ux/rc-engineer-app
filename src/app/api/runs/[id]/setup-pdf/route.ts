import { NextResponse } from "next/server";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { ensureRenderedRunSetupPdf } from "@/lib/setup/ensureRunSetupPdf";
import { SETUP_PDF_RENDER_PIPELINE_VERSION } from "@/lib/setup/renderTypes";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Single pipeline for in-app PDF view and download: derived bytes from base PDF + calibration + run snapshot.
 * Renders lazily on first request; cache ref is `Run.renderedSetupPdfPath` (local path or Blob URL).
 */
export async function GET(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const { id } = await ctx.params;
  const { searchParams } = new URL(request.url);
  const download = searchParams.get("download") === "1";

  const ensured = await ensureRenderedRunSetupPdf({ userId: user.id, runId: id });
  if (!ensured) {
    return NextResponse.json(
      { error: "No mapped PDF source for this run (upload a setup PDF and calibrate, or load setup from one)." },
      { status: 404 }
    );
  }

  let bytes: Buffer;
  try {
    bytes = await readBytesFromStorageRef(ensured.relativePath);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Rendered PDF not found in storage";
    return NextResponse.json({ error: message }, { status: 404 });
  }

  const filename = `setup-run-${id}.pdf`;
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "X-Setup-Pdf-Render-Version": String(SETUP_PDF_RENDER_PIPELINE_VERSION),
      ...(download
        ? { "Content-Disposition": `attachment; filename="${filename}"` }
        : { "Content-Disposition": `inline; filename="${filename}"` }),
      "Cache-Control": "private, max-age=120",
    },
  });
}
