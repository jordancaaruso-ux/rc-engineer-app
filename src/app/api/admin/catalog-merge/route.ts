import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { mergeTireTypes, mergeTracks } from "@/lib/assets/mergeCatalog";

/**
 * Admin merges a duplicate catalog row (loser) into the canonical one (winner): repoints all
 * dependents onto the winner and deletes the loser. See docs/ASSET_ACCESS_NORTH_STAR.md.
 */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAuthAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    type?: string;
    winnerId?: string;
    loserId?: string;
  } | null;

  const type = body?.type;
  const winnerId = body?.winnerId?.trim();
  const loserId = body?.loserId?.trim();

  if ((type !== "tire" && type !== "track") || !winnerId || !loserId) {
    return NextResponse.json({ error: "type (tire|track), winnerId, loserId are required" }, { status: 400 });
  }
  if (winnerId === loserId) {
    return NextResponse.json({ error: "winner and loser are the same row" }, { status: 400 });
  }

  // Confirm both rows exist before mutating.
  if (type === "tire") {
    const [winner, loser] = await Promise.all([
      prisma.tireType.findUnique({ where: { id: winnerId }, select: { id: true } }),
      prisma.tireType.findUnique({ where: { id: loserId }, select: { id: true } }),
    ]);
    if (!winner || !loser) {
      return NextResponse.json({ error: "Tire type not found" }, { status: 404 });
    }
    await mergeTireTypes({ winnerId, loserId });
  } else {
    const [winner, loser] = await Promise.all([
      prisma.track.findUnique({ where: { id: winnerId }, select: { id: true } }),
      prisma.track.findUnique({ where: { id: loserId }, select: { id: true } }),
    ]);
    if (!winner || !loser) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }
    await mergeTracks({ winnerId, loserId });
  }

  return NextResponse.json({ ok: true, winnerId });
}
