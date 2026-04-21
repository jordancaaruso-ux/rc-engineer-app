import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { validateTimingHttpUrl } from "@/lib/lapImport/service";
import {
  isLiveRcPracticeListUrl,
  isLiveRcResultsDiscoveryUrl,
} from "@/lib/lapWatch/livercSessionIndexParsers";

export const dynamic = "force-dynamic";

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  try {
    const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!user?.id) {
      return NextResponse.json({ error: "Missing user id", code: "missing_user" }, { status: 401 });
    }

    const rows = await prisma.watchedLapSource.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        sourceUrl: true,
        targetMode: true,
        targetClass: true,
        targetDriverOverride: true,
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
  } catch (e) {
    const msg = errMessage(e);
    // Helps debug the "Could not load watched sources" symptom.
    console.error("[api/lap-watch/sources] GET failed", { error: msg });

    const looksLikeMissingTable =
      /WatchedLapSource/i.test(msg) && (/does not exist/i.test(msg) || /P2021/i.test(msg) || /P2022/i.test(msg));
    if (looksLikeMissingTable) {
      return NextResponse.json(
        {
          error: "WatchedLapSource table is missing (migration not applied). Run `npx prisma migrate deploy`.",
          code: "watched_source_table_missing",
          detail: msg,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ error: "Failed to load watched sources", code: "watched_sources_get_failed", detail: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as
    | { sourceUrl?: unknown; targetClass?: unknown; carId?: unknown }
    | null;

  const sourceUrl = typeof body?.sourceUrl === "string" ? body.sourceUrl.trim() : "";
  const v = validateTimingHttpUrl(sourceUrl);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const targetClass = typeof body?.targetClass === "string" && body.targetClass.trim() ? body.targetClass.trim() : null;
  const carId = typeof body?.carId === "string" && body.carId.trim() ? body.carId.trim() : null;

  const targetMode = isLiveRcPracticeListUrl(v.normalized)
    ? "driver"
    : isLiveRcResultsDiscoveryUrl(v.normalized)
      ? "class"
      : "none";

  if (targetMode === "class" && !targetClass) {
    return NextResponse.json({ error: "Race class is required for results sources." }, { status: 400 });
  }

  const row = await prisma.watchedLapSource.create({
    data: {
      userId: user.id,
      sourceUrl: v.normalized,
      targetMode,
      targetClass: targetMode === "class" ? targetClass : null,
      targetDriverOverride: null,
      driverName: null,
      carId,
    },
    select: { id: true },
  });
  return NextResponse.json({ id: row.id }, { status: 201 });
}

