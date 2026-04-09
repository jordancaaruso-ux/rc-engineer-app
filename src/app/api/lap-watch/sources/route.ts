import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { validateTimingHttpUrl } from "@/lib/lapImport/service";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const rows = await prisma.watchedLapSource.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      sourceUrl: true,
      driverName: true,
      carId: true,
      lastCheckedAt: true,
      lastSeenSessionCompletedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({
    sources: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      lastCheckedAt: r.lastCheckedAt ? r.lastCheckedAt.toISOString() : null,
      lastSeenSessionCompletedAt: r.lastSeenSessionCompletedAt ? r.lastSeenSessionCompletedAt.toISOString() : null,
    })),
  });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const body = (await request.json().catch(() => null)) as
    | { sourceUrl?: unknown; driverName?: unknown; carId?: unknown }
    | null;

  const sourceUrl = typeof body?.sourceUrl === "string" ? body.sourceUrl.trim() : "";
  const v = validateTimingHttpUrl(sourceUrl);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const driverName = typeof body?.driverName === "string" && body.driverName.trim() ? body.driverName.trim() : null;
  const carId = typeof body?.carId === "string" && body.carId.trim() ? body.carId.trim() : null;

  const row = await prisma.watchedLapSource.create({
    data: {
      userId: user.id,
      sourceUrl: v.normalized,
      driverName,
      carId,
    },
    select: { id: true },
  });
  return NextResponse.json({ id: row.id }, { status: 201 });
}

