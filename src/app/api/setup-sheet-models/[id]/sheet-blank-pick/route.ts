import { NextResponse } from "next/server";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { editionBlankIdForData } from "@/lib/setupSheetModels/sheetBlankResolve";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

/** Enough to identify any edition; a setup's distinctive keys show up long before this. */
const MAX_KEYS = 200;

/**
 * Which of this chassis's sheets can draw a setup with these keys — `null` meaning the primary.
 *
 * Exists for the one surface whose values live in the browser when the sheet is chosen: the
 * log-run fill seeds from the previous setup client-side, so the server pages' per-setup pick
 * (`sheetBlankResolve`) cannot run for it. The keys are sent rather than the values because keys
 * are all the pick reads — see `pickSheetBlankForData` — and a setup's values are the driver's.
 *
 * Global like the plan and page routes: a sheet's box list is nobody's setup.
 */
export async function GET(request: Request, ctx: RouteCtx): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const url = new URL(request.url);
  const keys = (url.searchParams.get("keys") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, MAX_KEYS);

  /*
   * The seeded setup's STAMP, when the caller knows which snapshot it seeded from. Aligned
   * editions carry the same keys as the primary, so keys alone can no longer tell the papers
   * apart — the stamp can (see `pickSheetBlankForData`). Scoped to the caller's own snapshots:
   * the id is client-supplied, and reading a stranger's row — even one column of it — is not
   * this route's to give. A teammate-seeded fill falls back to keys, as before.
   */
  const snapshotId = url.searchParams.get("snapshot")?.trim() || null;
  const snapshot = snapshotId
    ? await prisma.setupSnapshot.findFirst({
        where: { id: snapshotId, userId },
        select: { sheetBlankId: true },
      })
    : null;

  const editionBlankId = await editionBlankIdForData(
    id,
    Object.fromEntries(keys.map((k) => [k, true])),
    { sheetBlankId: snapshot?.sheetBlankId }
  );
  return NextResponse.json({ editionBlankId }, { headers: { "Cache-Control": "no-store" } });
}
