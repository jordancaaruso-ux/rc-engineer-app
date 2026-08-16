import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { buildSheetPlan, parseStoredBoxes, chassisFillsAsSheet } from "@/lib/setupSheetModels/sheetPlan";
import { wherePrimarySheetBlank } from "@/lib/setupSheetModels/sheetBlankResolve";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * The box list for a chassis, as ordinary JSON.
 *
 * The production replacement for `/api/debug/sheet-plan`, and unlike that one it never opens a PDF:
 * the geometry was stored when the sheet was uploaded. That is what makes this cheap enough to call
 * on every fill, and what keeps the sheet working after the uploader deletes their account.
 *
 * WHY AN ENDPOINT AND NOT A PAGE PROP. A 289-box sheet is a large value, and handing it to the
 * browser through Next's streaming page format broke roughly one load in three when a single large
 * value spanned a chunk boundary — measured at 289 boxes, never at 15. Fetching it uses none of
 * that machinery, keeps the page's own HTML small, and lets the box list cache on its own.
 *
 * `?blank=<id>` asks for one of the chassis's EDITIONS — a rebuilt copy of the sheet with its own
 * boxes and its own field list (`schemaFieldsJson`); without it the primary blank answers, read
 * against the model's canonical schema, exactly as before editions existed.
 *
 * Chassis are global, so any signed-in driver may read any chassis's plan. There is nothing
 * personal here: it is the shape of a manufacturer's sheet, not anybody's setup.
 */
export async function GET(request: Request, ctx: RouteCtx): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const blankId = new URL(request.url).searchParams.get("blank");

  const model = await prisma.setupSheetModel.findUnique({
    where: { id },
    select: { id: true, name: true, schemaJson: true },
  });
  if (!model) return NextResponse.json({ error: "Unknown chassis" }, { status: 404 });

  const blank = await prisma.setupSheetBlank.findFirst({
    // Scoped to the model either way, so a foreign blank id cannot borrow this chassis's name.
    where: blankId ? { id: blankId, setupSheetModelId: model.id } : wherePrimarySheetBlank(model.id),
    orderBy: { createdAt: "asc" },
    select: { boxesJson: true, fillSurface: true, pageCount: true, schemaFieldsJson: true, isEdition: true },
  });

  /*
   * An edition's vocabulary is its own: its field list rides on the blank, because pushing minted
   * keys into the curated model schema would surface them in every driver's analysis screens.
   * Wrapped in a schema shell so both paths go through the same whitelist parser.
   */
  const schema = chassisFillsAsSheet(blank)
    ? parseSetupSheetModelSchema(
        blank?.isEdition && Array.isArray(blank.schemaFieldsJson)
          ? { version: 1, label: model.name, structuredSections: [], fields: blank.schemaFieldsJson }
          : model.schemaJson
      )
    : null;

  /*
   * The plan is returned at the TOP LEVEL, not nested under a key.
   *
   * `SheetFillSurface` fetches this URL itself and reads `{ fields, boxes, pageCount }` straight
   * off the response — that is what lets the box list travel as its own cacheable request instead
   * of through the page props. `sheetMode` and `chassisName` ride alongside for callers deciding
   * which surface to open; the surface ignores them.
   *
   * A chassis with no sheet is a 200 with empty lists, not a 404. It is not an error — plenty of
   * chassis fill as the ordinary form — and a 404 here would also mean "no such chassis", which is
   * a different thing the caller must handle differently.
   */
  if (!schema) {
    return NextResponse.json({
      sheetMode: false,
      chassisName: model.name,
      fields: [],
      boxes: [],
      pageCount: 1,
    });
  }

  const plan = buildSheetPlan({ schema, boxes: parseStoredBoxes(blank?.boxesJson) });
  return NextResponse.json({ sheetMode: true, chassisName: model.name, ...plan });
}
