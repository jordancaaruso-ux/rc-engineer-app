import { NextResponse } from "next/server";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
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
  const keys = (new URL(request.url).searchParams.get("keys") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, MAX_KEYS);

  const editionBlankId = await editionBlankIdForData(
    id,
    Object.fromEntries(keys.map((k) => [k, true]))
  );
  return NextResponse.json({ editionBlankId }, { headers: { "Cache-Control": "no-store" } });
}
