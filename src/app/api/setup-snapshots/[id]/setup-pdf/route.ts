import { NextResponse } from "next/server";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { ensureRenderedSetupSnapshotPdf } from "@/lib/setup/ensureRunSetupPdf";
import { SETUP_PDF_RENDER_PIPELINE_VERSION } from "@/lib/setup/renderTypes";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Filled PDF for a stored setup snapshot (base template + calibration + current `SetupSnapshot.data`).
 * Same render pipeline as run setup PDF; requires a resolvable PDF source document + calibration.
 */
export async function GET(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const { searchParams } = new URL(request.url);
  const download = searchParams.get("download") === "1";

  const ensured = await ensureRenderedSetupSnapshotPdf({ userId: userId, setupSnapshotId: id });
  if (!ensured) {
    return NextResponse.json(
      {
        error:
          "No PDF template and calibration for this setup (import from a setup PDF, or use a setup linked from one).",
      },
      { status: 404 }
    );
  }

  // `ensure` already read the file (that is how it knows the cache is warm), so there is nothing
  // left to fetch and nothing left to fail — a file it could not read is a null above.
  const bytes = ensured.bytes;

  const filename = `setup-snapshot-${id}.pdf`;
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
