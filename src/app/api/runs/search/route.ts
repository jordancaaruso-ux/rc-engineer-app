import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { hasTeammateLink } from "@/lib/teammateRunAccess";

/** Filtered runs for Engineer compare pickers + search (same shape as for-picker). */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const { searchParams } = new URL(request.url);
  const carId = searchParams.get("carId")?.trim() || null;
  const eventId = searchParams.get("eventId")?.trim() || null;
  const trackId = searchParams.get("trackId")?.trim() || null;
  const forUserIdRaw = searchParams.get("forUserId")?.trim() || null;
  const q = searchParams.get("q")?.trim().toLowerCase() || "";
  const dateFrom = searchParams.get("dateFrom")?.trim() || null;
  const dateTo = searchParams.get("dateTo")?.trim() || null;
  const take = Math.min(300, Math.max(1, Number(searchParams.get("take")) || 200));

  let runOwnerId = user.id;
  if (forUserIdRaw && forUserIdRaw !== user.id) {
    const ok = await hasTeammateLink(user.id, forUserIdRaw);
    if (!ok) {
      return NextResponse.json({ error: "Not allowed to list this user’s runs" }, { status: 403 });
    }
    runOwnerId = forUserIdRaw;
  }

  const where: NonNullable<Parameters<typeof prisma.run.findMany>[0]>["where"] = {
    userId: runOwnerId,
  };
  if (carId) where.carId = carId;
  if (eventId) where.eventId = eventId;
  if (trackId) where.trackId = trackId;

  const runs = await prisma.run.findMany({
    where,
    orderBy: { sortAt: "desc" },
    take,
    select: {
      id: true,
      createdAt: true,
      sessionCompletedAt: true,
      sortAt: true,
      sessionLabel: true,
      sessionType: true,
      meetingSessionType: true,
      meetingSessionCode: true,
      eventId: true,
      trackId: true,
      carId: true,
      carNameSnapshot: true,
      trackNameSnapshot: true,
      notes: true,
      driverNotes: true,
      handlingProblems: true,
      lapTimes: true,
      setupSnapshot: { select: { id: true, data: true } },
      car: { select: { name: true } },
      track: { select: { name: true } },
      event: { select: { name: true } },
    },
  });

  let filtered = runs;

  if (dateFrom || dateTo) {
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00.000`) : null;
    const to = dateTo ? new Date(`${dateTo}T23:59:59.999`) : null;
    filtered = runs.filter((r) => {
      const t = resolveRunDisplayInstant({
        createdAt: r.createdAt,
        sessionCompletedAt: r.sessionCompletedAt,
        sortAt: r.sortAt,
      }).getTime();
      const d = new Date(t);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }

  if (q) {
    filtered = filtered.filter((r) => {
      const hay = [
        r.car?.name,
        r.carNameSnapshot,
        r.track?.name,
        r.trackNameSnapshot,
        r.event?.name,
        r.sessionLabel,
        r.notes,
        r.driverNotes,
        r.handlingProblems,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  return NextResponse.json({ runs: filtered });
}
