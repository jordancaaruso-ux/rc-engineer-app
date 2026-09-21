import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { normalizeSpeedhiveTransponderNumber } from "@/lib/speedhive/speedhiveTransponder";

/**
 * Whose practice this brought-in session is, and where: the transponder it was found under, the
 * name the timing site printed beside it, and the track whose practice list it was ticked from.
 *
 * The import itself cannot say. A MYLAPS practice loop is fetched by activity id and names
 * nobody, and LiveRC's session page is parsed for laps, not for its chip. The practice list DOES
 * know — it is what the driver was ticked from — so it writes that down here, beside the laps, in
 * the stored parse's `sessionHint`. That is what lets the lap sheet head the column with the name
 * you saved for that chip on any later visit, not just the one where you ticked it.
 *
 * The track matters as much. An import only learns its track from a run it is linked to, and a
 * rival's practice is linked to none — so the lap sheet's default "this track only" scope dropped
 * it on the next page load, and "Detailed analysis" arrived without the column you had just
 * ticked. Kept here as a NAME, deliberately not as the row's `trackId`: that column means "the
 * sweep found YOUR session at this track", and a rival's laps must never be offered to file as
 * your run.
 *
 * Additive JSON on a row the asker owns; nothing reads these keys but the lap sheet.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const body = (await request.json().catch(() => null)) as {
    transponder?: string | null;
    siteName?: string | null;
    trackId?: string | null;
  } | null;
  const transponder = normalizeSpeedhiveTransponderNumber(String(body?.transponder ?? ""));
  if (!transponder) {
    return NextResponse.json({ error: "A transponder number is required." }, { status: 400 });
  }
  const siteName = typeof body?.siteName === "string" ? body.siteName.trim().slice(0, 120) : "";
  // The name is read from our own row, never taken from the caller.
  const trackId = typeof body?.trackId === "string" ? body.trackId.trim() : "";
  const track = trackId
    ? await prisma.track.findUnique({ where: { id: trackId }, select: { name: true } })
    : null;
  const trackName = track?.name?.trim() || null;

  const row = await prisma.importedLapTimeSession.findFirst({
    where: { id, userId },
    select: { id: true, parsedPayload: true },
  });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const payload =
    row.parsedPayload && typeof row.parsedPayload === "object" && !Array.isArray(row.parsedPayload)
      ? (row.parsedPayload as Record<string, unknown>)
      : {};
  const hint =
    payload.sessionHint && typeof payload.sessionHint === "object" && !Array.isArray(payload.sessionHint)
      ? (payload.sessionHint as Record<string, unknown>)
      : {};
  if (
    hint.practiceTransponder === transponder &&
    (hint.practiceSiteName ?? "") === siteName &&
    (hint.practiceTrackName ?? null) === (trackName ?? hint.practiceTrackName ?? null)
  ) {
    return NextResponse.json({ ok: true });
  }

  await prisma.importedLapTimeSession.update({
    where: { id: row.id },
    data: {
      parsedPayload: {
        ...payload,
        sessionHint: {
          ...hint,
          practiceTransponder: transponder,
          practiceSiteName: siteName || null,
          // A later call without a track must not forget the one already written.
          practiceTrackName: trackName ?? hint.practiceTrackName ?? null,
        },
      } as Prisma.InputJsonValue,
    },
  });
  return NextResponse.json({ ok: true });
}
