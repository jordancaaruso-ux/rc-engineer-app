import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { isAuthAdminEmail } from "@/lib/authAdmin";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Clear an upload off the founder's queue, or put it back on.
 *
 * Only refusals need this. A sheet that became a chassis leaves the queue by being authorized,
 * which is a decision with consequences downstream; a flat PDF has no chassis to authorize, so
 * without a stamp of its own it would sit there for good.
 *
 * Nothing about the file changes — it is kept either way, because the founder may still want to
 * make it fillable later.
 */
export async function PATCH(request: Request, ctx: Ctx): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAuthAdminEmail(user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { reviewed?: boolean } | null;
  if (typeof body?.reviewed !== "boolean") {
    return NextResponse.json({ error: "Expected { reviewed: boolean }" }, { status: 400 });
  }

  const existing = await prisma.setupSheetBlank.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.setupSheetBlank.update({
    where: { id },
    data: { reviewedAt: body.reviewed ? new Date() : null },
    select: { id: true, reviewedAt: true },
  });
  return NextResponse.json({ ok: true, blank: updated });
}
