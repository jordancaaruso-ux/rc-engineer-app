import "server-only";

import { prisma } from "@/lib/prisma";
import { buildSessionPageUrl } from "@/lib/speedhive/speedhiveClient";
import type { SpeedhiveDiscoveredSession } from "@/lib/speedhive/discoverSpeedhiveSessionsForUser";
import { getMylapsConnection } from "@/lib/mylaps/mylapsConnection";
import {
  fetchMylapsAchievementBadges,
  fetchMylapsTimeline,
} from "@/lib/mylaps/mylapsUsersApi";

function sessionSortKey(iso: string | null): number {
  if (!iso?.trim()) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function rowFromBadge(
  b: {
    eventId?: number;
    sessionId?: number;
    sessionName?: string | null;
    eventName?: string | null;
    eventDate?: string | null;
    className?: string | null;
    racer?: { name?: string | null };
  },
  seen: Set<string>
): SpeedhiveDiscoveredSession | null {
  if (!b.sessionId || !b.eventId) return null;
  const sessionId = String(b.sessionId);
  const key = `${b.eventId}:${sessionId}`;
  if (seen.has(key)) return null;
  seen.add(key);
  const completedIso =
    typeof b.eventDate === "string" && b.eventDate.trim()
      ? new Date(b.eventDate).toISOString()
      : null;
  const label = [b.sessionName, b.racer?.name, b.eventName, b.className]
    .filter((x) => typeof x === "string" && x.trim())
    .join(" · ");
  return {
    sessionUrl: buildSessionPageUrl(b.eventId, b.sessionId),
    sessionId,
    sessionCompletedAtIso: completedIso,
    sourceKind: "race",
    label: label || `Session ${sessionId}`,
    alreadyImported: false,
    linkedRunId: null,
    timingSource: "speedhive",
  };
}

function rowFromTimelineMessage(
  m: {
    eventId?: string | null;
    sessionId?: string | null;
    timelineName?: string | null;
    racerName?: string | null;
    eventName?: string | null;
    utc?: string | null;
  },
  seen: Set<string>
): SpeedhiveDiscoveredSession | null {
  const sessionId = m.sessionId?.trim();
  const eventId = m.eventId?.trim();
  if (!sessionId || !eventId) return null;
  const eid = Number(eventId);
  const sid = Number(sessionId);
  if (!Number.isFinite(eid) || !Number.isFinite(sid)) return null;
  const key = `${eid}:${sid}`;
  if (seen.has(key)) return null;
  seen.add(key);
  const completedIso =
    typeof m.utc === "string" && m.utc.trim() ? new Date(m.utc).toISOString() : null;
  const label = [m.timelineName, m.racerName, m.eventName].filter(Boolean).join(" · ");
  return {
    sessionUrl: buildSessionPageUrl(eid, sid),
    sessionId: String(sid),
    sessionCompletedAtIso: completedIso,
    sourceKind: "race",
    label: label || `Session ${sid}`,
    alreadyImported: false,
    linkedRunId: null,
    timingSource: "speedhive",
  };
}

export type DiscoverMylapsLinkedResult = {
  candidates: SpeedhiveDiscoveredSession[];
  unimportedCandidates: SpeedhiveDiscoveredSession[];
  mostRecentSession: SpeedhiveDiscoveredSession | null;
  hint: string | null;
  accountId: string | null;
};

export async function discoverMylapsLinkedSessions(input: {
  userId: string;
  eventRaceClass?: string | null;
}): Promise<DiscoverMylapsLinkedResult> {
  const conn = await getMylapsConnection(input.userId);
  if (!conn) {
    return {
      candidates: [],
      unimportedCandidates: [],
      mostRecentSession: null,
      hint: null,
      accountId: null,
    };
  }

  const raceClassFilter = input.eventRaceClass?.trim().toLowerCase() ?? null;
  const seen = new Set<string>();
  const discovered: SpeedhiveDiscoveredSession[] = [];

  try {
    const [badges, timeline] = await Promise.all([
      fetchMylapsAchievementBadges(conn.accountId, conn.accessToken),
      fetchMylapsTimeline(conn.accountId, conn.accessToken),
    ]);

    for (const b of badges) {
      if (raceClassFilter && b.className?.trim().toLowerCase() !== raceClassFilter) continue;
      const row = rowFromBadge(b, seen);
      if (row) discovered.push(row);
    }

    for (const m of timeline) {
      const row = rowFromTimelineMessage(m, seen);
      if (row) discovered.push(row);
    }
  } catch (e) {
    return {
      candidates: [],
      unimportedCandidates: [],
      mostRecentSession: null,
      accountId: conn.accountId,
      hint: e instanceof Error ? e.message : "Could not load sessions from linked MYLAPS account.",
    };
  }

  const urls = discovered.map((d) => d.sessionUrl);
  const imports =
    urls.length > 0
      ? await prisma.importedLapTimeSession.findMany({
          where: { userId: input.userId, sourceUrl: { in: urls } },
          select: { sourceUrl: true, linkedRunId: true },
        })
      : [];
  const importByUrl = new Map(imports.map((i) => [i.sourceUrl, i.linkedRunId]));
  for (const d of discovered) {
    if (importByUrl.has(d.sessionUrl)) {
      d.alreadyImported = true;
      d.linkedRunId = importByUrl.get(d.sessionUrl) ?? null;
    }
  }

  const sorted = [...discovered].sort(
    (a, b) => sessionSortKey(b.sessionCompletedAtIso) - sessionSortKey(a.sessionCompletedAtIso)
  );
  const unimported = sorted.filter((d) => !d.alreadyImported);

  return {
    candidates: sorted,
    unimportedCandidates: unimported,
    mostRecentSession: unimported[0] ?? sorted[0] ?? null,
    accountId: conn.accountId,
    hint:
      unimported.length > 0
        ? null
        : sorted.length > 0
          ? "All sessions from your MYLAPS account are already imported."
          : "No race sessions found on your linked MYLAPS account yet.",
  };
}
