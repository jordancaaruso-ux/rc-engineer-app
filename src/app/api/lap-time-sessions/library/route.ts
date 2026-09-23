import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { loadSessionNames, SESSION_NAMING_SELECT } from "@/lib/lapImport/loadSessionNames";
import { newestSessionFirst } from "@/lib/lapImport/sessionNaming";

/** A ceiling, not a page size: far past any account today. */
const LIBRARY_MAX = 2000;

/**
 * The Laptime Analysis list: every imported session, named, split into yours and other drivers',
 * newest race first (founder call, 2026-09-24).
 *
 * "My runs" is every session on one of your runs, and every sheet you're on — your name, your
 * chip, or the sweep found it by your chip. Everything else is "Other drivers": an event page's
 * other races, a rival's practice, a MyRCM result you only watched. A PDF you uploaded was
 * counted as yours whoever was on it, which filed strangers' races under My runs.
 *
 * The whole account, not the newest 200 imports: capped at 200, every run imported before them
 * was missing from My runs. It stays light by sending names, not laps — the lap-sheet pickers
 * keep the plain list route for those.
 */
export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [rows, total, viewerUser] = await Promise.all([
    prisma.importedLapTimeSession.findMany({
      where: { userId, hiddenAt: null },
      orderBy: { createdAt: "desc" },
      take: LIBRARY_MAX,
      select: { ...SESSION_NAMING_SELECT, detectedPrimaryForRun: { select: { id: true } } },
    }),
    prisma.importedLapTimeSession.count({ where: { userId, hiddenAt: null } }),
    prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } }),
  ]);

  const names = await loadSessionNames({
    userId,
    rows,
    timeZone: viewerUser?.timeZone?.trim() || null,
  });

  const sessions = rows
    .flatMap((r) => {
      const name = names.get(r.id);
      if (!name) return [];
      const onRun = r.linkedRunId != null || r.detectedPrimaryForRun != null;
      return [{ id: r.id, sourceUrl: r.sourceUrl, onRun, mine: onRun || name.isViewer, name }];
    })
    .sort((a, b) => newestSessionFirst(a.name, b.name));

  return NextResponse.json({ sessions, total });
}
