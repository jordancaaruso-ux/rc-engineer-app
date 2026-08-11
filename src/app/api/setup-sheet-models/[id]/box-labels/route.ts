import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { applyBoxLabels, namedBoxCount } from "@/lib/setupSheetModels/applyBoxLabels";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Say what the boxes on a chassis's sheet are.
 *
 * Admin only, and deliberately so: naming is the founder's job. Drivers were never going to name
 * two hundred boxes uniformly enough to compare across cars, and one driver must not be able to
 * relabel a chassis every other driver is using.
 *
 * Only labels move. See `applyBoxLabels` for why the keys cannot.
 */
export async function PATCH(request: Request, ctx: Ctx): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAuthAdminEmail(user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { labels?: unknown } | null;
  const raw = body?.labels;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return NextResponse.json({ error: "Expected { labels: { key: name } }" }, { status: 400 });
  }
  const labels: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") labels[k] = v;
  }

  const model = await prisma.setupSheetModel.findUnique({
    where: { id },
    select: { id: true, name: true, schemaJson: true },
  });
  if (!model) return NextResponse.json({ error: "Unknown chassis" }, { status: 404 });

  const schema = parseSetupSheetModelSchema(model.schemaJson);
  if (!schema) return NextResponse.json({ error: "This chassis has no readable sheet" }, { status: 409 });

  const result = applyBoxLabels(schema, labels);
  if (result.changed.length > 0) {
    await prisma.setupSheetModel.update({
      where: { id },
      data: { schemaJson: result.schema as object },
    });
  }

  return NextResponse.json({
    ok: true,
    changed: result.changed.length,
    pooled: result.pooled,
    unknownKeys: result.unknownKeys,
    namedCount: namedBoxCount(result.schema),
    boxCount: result.schema.fields.length,
  });
}
