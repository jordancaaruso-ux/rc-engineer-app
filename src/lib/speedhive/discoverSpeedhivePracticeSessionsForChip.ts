import "server-only";

import { prisma } from "@/lib/prisma";
import {
  fetchPracticeLocation,
  fetchPracticeSessionsForChipAtLocation,
  fetchPracticeTrainingSessions,
  practiceTimestampToIso,
  type SpeedhivePracticeTrainingSession,
} from "@/lib/speedhive/speedhivePracticeClient";
import {
  buildSpeedhivePracticeRunUrl,
  practiceLocationIdFromTrackUrl,
} from "@/lib/speedhive/speedhivePracticeUrl";
import { normalizeSpeedhiveTransponderNumber } from "@/lib/speedhive/speedhiveTransponder";

/**
 * One transponder's practice at one track — anyone's, not just yours.
 *
 * MYLAPS' practice API is keyed on the chip and takes no credentials: the same three calls
 * `discoverSpeedhivePracticeSessionsForUser` already makes work on a stranger's number, and
 * always did. That function is welded to the viewer's identity (their names, their chips,
 * their already-imported rows, their status card), so widening it would have meant threading
 * "whose?" through every branch of it. This is the same walk with the identity as an argument.
 *
 * ON DEMAND ONLY (founder call 2026-08-27). Nothing schedules this. A rival's laps are
 * fetched at the moment someone asks to see them and not a minute before — polling a timing
 * service on behalf of a driver who never signed up here is a different product.
 */

/** Activities to expand per pull. Each one costs a lap fetch, and this is a "show me" button. */
const MAX_ACTIVITIES = 8;

export type CompetitorPracticeSession = {
  /** The importable URL — the same shape a pasted Speedhive practice link has. */
  sessionUrl: string;
  sessionCompletedAtIso: string | null;
  lapCount: number;
  bestLapSeconds: number | null;
  /** Already in this user's library; the card offers "open" rather than "import". */
  importedSessionId: string | null;
};

export type CompetitorPracticeResult = {
  sessions: CompetitorPracticeSession[];
  trackLabel: string | null;
  /** The name MYLAPS has against this chip, when it says — worth showing, it confirms the number. */
  chipLabel: string | null;
  /** Plain-language reason there is nothing, never a raw error. */
  hint: string | null;
};

function lapSeconds(duration: string | undefined): number | null {
  const t = duration?.trim();
  if (!t || t === "-") return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function blockLapCount(block: SpeedhivePracticeTrainingSession): number {
  let n = 0;
  for (const lap of block.laps ?? []) if (lapSeconds(lap.duration) != null) n++;
  return n;
}

function blockBest(block: SpeedhivePracticeTrainingSession): number | null {
  let best: number | null = null;
  for (const lap of block.laps ?? []) {
    const s = lapSeconds(lap.duration);
    if (s != null && (best == null || s < best)) best = s;
  }
  return best;
}

function blockCompletedIso(block: SpeedhivePracticeTrainingSession): string | null {
  const start = block.dateTimeStart?.trim();
  if (start && !Number.isNaN(new Date(start).getTime())) return new Date(start).toISOString();
  return null;
}

function sortKey(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export async function discoverSpeedhivePracticeSessionsForChip(input: {
  /** Whose library to check for "already imported" — the asker, not the driver being looked up. */
  userId: string;
  trackSpeedhiveUrl: string;
  transponder: string;
}): Promise<CompetitorPracticeResult> {
  const chipCode = normalizeSpeedhiveTransponderNumber(input.transponder);
  if (!chipCode) {
    return { sessions: [], trackLabel: null, chipLabel: null, hint: "That transponder number doesn't look right." };
  }

  const locationId = practiceLocationIdFromTrackUrl(input.trackSpeedhiveUrl);
  if (!locationId) {
    return {
      sessions: [],
      trackLabel: null,
      chipLabel: null,
      hint: "This track has no MYLAPS practice page saved, so there's nothing to look in.",
    };
  }

  let trackLabel: string | null = null;
  let raw: Awaited<ReturnType<typeof fetchPracticeSessionsForChipAtLocation>>;
  try {
    const [location, sessions] = await Promise.all([
      fetchPracticeLocation(locationId),
      fetchPracticeSessionsForChipAtLocation(locationId, chipCode),
    ]);
    trackLabel = location?.name?.trim() || null;
    raw = sessions;
  } catch {
    // The raw error helps nobody standing at a track.
    return { sessions: [], trackLabel: null, chipLabel: null, hint: "Couldn't reach MYLAPS just now." };
  }

  if (raw.length === 0) {
    return {
      sessions: [],
      trackLabel,
      chipLabel: null,
      hint: `No practice for chip ${chipCode} at ${trackLabel ?? "this track"}.`,
    };
  }

  const ordered = [...raw].sort(
    (a, b) =>
      sortKey(practiceTimestampToIso(b.endtimeutc ?? b.starttimeutc)) -
      sortKey(practiceTimestampToIso(a.endtimeutc ?? a.starttimeutc))
  );

  const out: CompetitorPracticeSession[] = [];
  for (const activity of ordered.slice(0, MAX_ACTIVITIES)) {
    if (!activity.id) continue;
    const activityIso =
      practiceTimestampToIso(activity.endtimeutc) ?? practiceTimestampToIso(activity.starttimeutc);
    let blocks: SpeedhivePracticeTrainingSession[];
    try {
      blocks = await fetchPracticeTrainingSessions(activity.id);
    } catch {
      continue;
    }
    for (const block of blocks) {
      const lapCount = blockLapCount(block);
      if (lapCount === 0) continue;
      out.push({
        sessionUrl: buildSpeedhivePracticeRunUrl(locationId, activity.id, block.id),
        sessionCompletedAtIso: blockCompletedIso(block) ?? activityIso,
        lapCount,
        bestLapSeconds: blockBest(block),
        importedSessionId: null,
      });
    }
  }

  out.sort((a, b) => sortKey(b.sessionCompletedAtIso) - sortKey(a.sessionCompletedAtIso));

  const urls = out.map((s) => s.sessionUrl);
  if (urls.length > 0) {
    const existing = await prisma.importedLapTimeSession.findMany({
      where: { userId: input.userId, sourceUrl: { in: urls } },
      select: { id: true, sourceUrl: true },
    });
    const byUrl = new Map(existing.map((e) => [e.sourceUrl, e.id]));
    for (const s of out) s.importedSessionId = byUrl.get(s.sessionUrl) ?? null;
  }

  return {
    sessions: out,
    trackLabel,
    chipLabel: null,
    hint: out.length === 0 ? "Their sessions are there, but none of them recorded laps." : null,
  };
}
