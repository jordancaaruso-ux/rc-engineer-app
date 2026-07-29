import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * How many saved setups already hold a value for one parameter of a chassis type — shown before
 * deleting it from the sheet model, so a parameter with real data can't vanish unannounced.
 * Snapshots key their JSON by the schema's field key, so existence of the key is the test.
 */
export async function GET(request: Request, ctx: RouteCtx): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const key = new URL(request.url).searchParams.get("key")?.trim();
  if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });

  const model = await prisma.setupSheetModel.findUnique({ where: { id }, select: { id: true } });
  if (!model) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // jsonb_exists() rather than the `?` operator — `?` collides with driver placeholder syntax.
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count
    FROM "SetupSnapshot" s
    JOIN "Car" c ON c.id = s."carId"
    WHERE c."setupSheetModelId" = ${id}
      AND jsonb_exists(s.data, ${key})
  `;
  return NextResponse.json({ count: Number(rows[0]?.count ?? 0) });
}
