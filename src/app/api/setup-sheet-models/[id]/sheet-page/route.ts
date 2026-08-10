import { NextResponse } from "next/server";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getSheetPageImage } from "@/lib/setupSheetModels/sheetPageImages";
import { MAX_BLANK_PAGES } from "@/lib/setupSheetModels/blankUploadDiagnosis";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * One page of a chassis's setup sheet, as a picture.
 *
 * Drawn once per chassis and stored; see `sheetPageImages`. The first driver to open a chassis
 * waits a second or two for it, everyone after gets the stored copy.
 *
 * Cached hard in the browser because the answer cannot change: a sheet is a sheet, and the only
 * thing that would alter this picture is a different sheet, which is a different chassis. Marked
 * private, since it is served to signed-in drivers rather than to the open web.
 */
export async function GET(request: Request, ctx: RouteCtx): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const raw = new URL(request.url).searchParams.get("page") ?? "1";
  const pageNumber = Number(raw);
  // Bounded before it reaches the renderer: an unbounded page number is an invitation to ask a
  // server to rasterise page 9,000,000 of a two-page file.
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > MAX_BLANK_PAGES) {
    return NextResponse.json({ error: "No such page" }, { status: 400 });
  }

  const image = await getSheetPageImage(id, pageNumber);
  if (!image) return NextResponse.json({ error: "No sheet for this chassis" }, { status: 404 });

  return new NextResponse(new Uint8Array(image.bytes), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
