import "server-only";

import { prisma } from "@/lib/prisma";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { getIncludedLapDashboardMetrics, primaryLapRowsFromRun } from "@/lib/lapAnalysis";
import { canViewPeerRuns, peerAccessIsTeamOnly } from "@/lib/teammateRunAccess";
import { listTeamPeerUserIds } from "@/lib/teamAccess";
import { buildFocusedRunPairContext } from "@/lib/engineerPhase5/contextPacket";
import { formatLocalCalendarDate } from "@/lib/engineerPhase5/localCalendarInTimeZone";

export type LinkedTeammateRow = {
  peerUserId: string;
  email: string | null;
  name: string | null;
  label: string;
  /** `link` = one-way TeammateLink; `team` = mutual team only (no link row). */
  source: "link" | "team";
};

export async function listLinkedTeammatesForEngineer(viewingUserId: string): Promise<LinkedTeammateRow[]> {
  const links = await prisma.teammateLink.findMany({
    where: { userId: viewingUserId },
    select: {
      peerUserId: true,
      peer: { select: { email: true, name: true } },
    },
  });
  const fromLinks: LinkedTeammateRow[] = links.map((l) => {
    const email = l.peer.email ?? null;
    const name = l.peer.name ?? null;
    const label = name?.trim() || email?.trim() || l.peerUserId.slice(0, 8);
    return { peerUserId: l.peerUserId, email, name, label, source: "link" as const };
  });
  const linkedIds = new Set(fromLinks.map((r) => r.peerUserId));
  const teamPeerIds = (await listTeamPeerUserIds(viewingUserId)).filter((id) => !linkedIds.has(id));
  if (teamPeerIds.length === 0) return fromLinks;
  const extraUsers = await prisma.user.findMany({
    where: { id: { in: teamPeerIds } },
    select: { id: true, email: true, name: true },
  });
  const fromTeam: LinkedTeammateRow[] = extraUsers.map((u) => {
    const email = u.email ?? null;
    const name = u.name ?? null;
    const label = `${name?.trim() || email?.trim() || u.id.slice(0, 8)} (team)`;
    return { peerUserId: u.id, email, name, label, source: "team" as const };
  });
  return [...fromLinks, ...fromTeam];
}

/** Resolve "bob" / partial email to a single linked peer, or null if ambiguous / none. */
export async function resolveTeammatePeerUserId(
  viewingUserId: string,
  query: string
): Promise<{ ok: true; peer: LinkedTeammateRow } | { ok: false; error: string; candidates?: LinkedTeammateRow[] }> {
  const q = query.trim().toLowerCase();
  if (!q) return { ok: false, error: "Empty teammate query." };
  const all = await listLinkedTeammatesForEngineer(viewingUserId);
  if (all.length === 0) {
    return {
      ok: false,
      error:
        "No teammates available (add a linked teammate on the Engineer compare section, or join a pilot team).",
    };
  }

  const scored = all
    .map((t) => {
      const email = (t.email ?? "").toLowerCase();
      const name = (t.name ?? "").toLowerCase();
      let score = 0;
      if (email === q) score = 100;
      else if (name === q) score = 95;
      else if (email.includes(q)) score = 80;
      else if (name.includes(q)) score = 75;
      else if (q.length >= 2 && (email.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q)))) score = 60;
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { ok: false, error: `No teammate matched "${query}".`, candidates: all };
  }
  if (scored.length > 1 && scored[0]!.score === scored[1]!.score && scored[0]!.score < 90) {
    return {
      ok: false,
      error: `Multiple teammates could match "${query}". Be more specific (full email or name).`,
      candidates: scored.slice(0, 5).map((s) => s.t),
    };
  }
  return { ok: true, peer: scored[0]!.t };
}

export type SearchRunsForEngineerArgs = {
  owner_scope: "mine" | "teammate";
  /** When owner_scope is teammate: match linked teammate by name/email fragment. */
  teammate_query?: string | null;
  date_from?: string | null;
  date_to?: string | null;
  car_id?: string | null;
  track_id?: string | null;
  event_id?: string | null;
  text_contains?: string | null;
  max_results?: number;
  /**
   * When set with date_from/date_to, filter by local calendar day in this IANA zone
   * (e.g. "today" matches the user's local day, not UTC).
   */
  calendar_time_zone?: string | null;
};

export type SearchRunsForEngineerResultRow = {
  runId: string;
  whenLabel: string;
  sortIso: string;
  carName: string;
  trackName: string;
  eventName: string | null;
  sessionSummary: string;
  lapCount: number;
  bestLapSeconds: number | null;
  owner: "you" | "teammate";
  teammateLabel: string | null;
};

export async function searchRunsForEngineerTool(
  viewingUserId: string,
  raw: SearchRunsForEngineerArgs
): Promise<{ ok: true; runs: SearchRunsForEngineerResultRow[]; truncated: boolean } | { ok: false; error: string }> {
  const maxResults = Math.min(40, Math.max(1, raw.max_results ?? 25));
  let runOwnerId = viewingUserId;
  let teammateLabel: string | null = null;
  let filterTeamOnlySharing = false;

  if (raw.owner_scope === "teammate") {
    const tq = raw.teammate_query?.trim();
    if (!tq) {
      return { ok: false, error: "owner_scope is teammate but teammate_query is missing. Use list_linked_teammates or pass teammate_query." };
    }
    const resolved = await resolveTeammatePeerUserId(viewingUserId, tq);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const allowed = await canViewPeerRuns(viewingUserId, resolved.peer.peerUserId);
    if (!allowed) return { ok: false, error: "Not allowed to view that peer's runs." };
    runOwnerId = resolved.peer.peerUserId;
    teammateLabel = resolved.peer.label;
    filterTeamOnlySharing = await peerAccessIsTeamOnly(viewingUserId, resolved.peer.peerUserId);
  }

  const where: NonNullable<Parameters<typeof prisma.run.findMany>[0]>["where"] = {
    userId: runOwnerId,
    ...(filterTeamOnlySharing ? { shareWithTeam: true } : {}),
  };
  if (raw.car_id?.trim()) where.carId = raw.car_id.trim();
  if (raw.event_id?.trim()) where.eventId = raw.event_id.trim();
  if (raw.track_id?.trim()) where.trackId = raw.track_id.trim();

  const hasDateFilter = Boolean(raw.date_from?.trim() || raw.date_to?.trim());
  const take = hasDateFilter
    ? Math.min(1200, Math.max(maxResults * 4, 200))
    : Math.min(300, Math.max(maxResults * 3, 80));

  const runs = await prisma.run.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      createdAt: true,
      sessionCompletedAt: true,
      carNameSnapshot: true,
      sessionType: true,
      meetingSessionType: true,
      meetingSessionCode: true,
      sessionLabel: true,
      lapTimes: true,
      lapSession: true,
      car: { select: { name: true } },
      track: { select: { name: true } },
      event: { select: { name: true } },
    },
  });

  let filtered = runs;

  if (raw.date_from?.trim() || raw.date_to?.trim()) {
    const fromStr = raw.date_from?.trim() ?? null;
    const toStr = raw.date_to?.trim() ?? null;
    const tz = raw.calendar_time_zone?.trim();
    if (tz) {
      filtered = runs.filter((r) => {
        const inst = resolveRunDisplayInstant({
          createdAt: r.createdAt,
          sessionCompletedAt: r.sessionCompletedAt,
        });
        const ymd = formatLocalCalendarDate(inst, tz);
        if (fromStr && ymd < fromStr) return false;
        if (toStr && ymd > toStr) return false;
        return true;
      });
    } else {
      const from = fromStr ? new Date(`${fromStr}T00:00:00.000Z`) : null;
      const to = toStr ? new Date(`${toStr}T23:59:59.999Z`) : null;
      filtered = runs.filter((r) => {
        const t = resolveRunDisplayInstant({
          createdAt: r.createdAt,
          sessionCompletedAt: r.sessionCompletedAt,
        }).getTime();
        const d = new Date(t);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    }
  }

  const q = raw.text_contains?.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter((r) => {
      const hay = [
        r.car?.name,
        r.carNameSnapshot,
        r.track?.name,
        r.sessionLabel,
        r.event?.name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  const truncated = filtered.length > maxResults;
  const slice = filtered.slice(0, maxResults);

  const rows: SearchRunsForEngineerResultRow[] = slice.map((run) => {
    const when = resolveRunDisplayInstant({
      createdAt: run.createdAt,
      sessionCompletedAt: run.sessionCompletedAt,
    });
    const dash = getIncludedLapDashboardMetrics(primaryLapRowsFromRun(run));
    return {
      runId: run.id,
      whenLabel: formatRunCreatedAtDateTime(when),
      sortIso: when.toISOString(),
      carName: run.car?.name ?? run.carNameSnapshot ?? "—",
      trackName: run.track?.name ?? "—",
      eventName: run.event?.name ?? null,
      sessionSummary: formatRunSessionDisplay({
        sessionType: run.sessionType,
        meetingSessionType: run.meetingSessionType,
        meetingSessionCode: run.meetingSessionCode,
        sessionLabel: run.sessionLabel,
      }),
      lapCount: dash.lapCount,
      bestLapSeconds: dash.bestLap,
      owner: raw.owner_scope === "teammate" ? "teammate" : "you",
      teammateLabel: raw.owner_scope === "teammate" ? teammateLabel : null,
    };
  });

  return { ok: true, runs: rows, truncated };
}

export async function applyEngineerFocusTool(
  viewingUserId: string,
  primaryRunId: string,
  compareRunId: string | null | undefined
): Promise<
  | { ok: true; focusedRunPair: NonNullable<Awaited<ReturnType<typeof buildFocusedRunPairContext>>> }
  | { ok: false; error: string }
> {
  const primary = primaryRunId?.trim();
  if (!primary) return { ok: false, error: "primary_run_id is required." };

  const ownPrimary = await prisma.run.findFirst({
    where: { id: primary, userId: viewingUserId },
    select: { id: true },
  });
  if (!ownPrimary) {
    return {
      ok: false,
      error:
        "Primary run must belong to the current user. Search with owner_scope mine and use that run id, or pick your run first.",
    };
  }

  const cid = compareRunId?.trim() || null;
  const focused = await buildFocusedRunPairContext(viewingUserId, primary, cid);
  if (!focused) return { ok: false, error: "Could not load focused runs." };

  if (cid && focused.compareRunId == null) {
    return {
      ok: false,
      error:
        "Compare run not found or not allowed. For a peer's run, primary must share the same track as the compare run and you must be linked or share a pilot team.",
    };
  }

  return { ok: true, focusedRunPair: focused };
}
