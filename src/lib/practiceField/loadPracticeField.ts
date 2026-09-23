import "server-only";

import { prisma } from "@/lib/prisma";
import { getLiveRcDriverNameSetting } from "@/lib/appSettings";
import {
  liveRcNameMatchesConfigured,
  normalizeLiveRcDriverNameForMatch,
} from "@/lib/lapWatch/liveRcNameNormalize";
import {
  getSpeedhiveDriverNamesForUser,
  getSpeedhiveTransponderNumbersForUser,
} from "@/lib/speedhive/speedhiveDriverSettings";
import { normalizeSpeedhiveDriverNamesForMatch } from "@/lib/speedhive/speedhiveDriverNames";
import { speedhiveDriverNameMatchesAny } from "@/lib/speedhive/speedhiveNameNormalize";
import { fetchUrlText } from "@/lib/lapUrlParsers/fetchText";
import { extractPracticeSessions } from "@/lib/lapWatch/livercSessionIndexParsers";
import { buildPracticeSessionListUrl } from "@/lib/lapWatch/liveRcIndexHtmlParse";
import { normalizeLiveRcTrackOrigin } from "@/lib/lapWatch/liveRcTrackUrl";
import {
  fetchPracticeLocation,
  fetchPracticeLocationActivities,
} from "@/lib/speedhive/speedhivePracticeClient";
import { practiceLocationIdFromTrackUrl } from "@/lib/speedhive/speedhivePracticeUrl";
import {
  groupLiveRcPracticeRows,
  groupMylapsActivities,
  type PracticeFieldDriver,
  type PracticeFieldSource,
} from "@/lib/practiceField/practiceField";

/**
 * The network half of `practiceField.ts`: one look at one timing site, when asked.
 *
 * Each look is a single request to the timing site. LiveRC's day page carries every session's
 * laps and fast lap, so nothing more is needed; MYLAPS' activity list carries chips and visit
 * times only, and a driver's laps are fetched by `discoverSpeedhivePracticeSessionsForChip`
 * when that one driver is opened.
 */

/** Recent MYLAPS activity read per look. One page; a busy club fills it in about a weekend. */
const MYLAPS_RECENT_ACTIVITIES = 100;

export type PracticeFieldResult = {
  source: PracticeFieldSource;
  /** LiveRC only — the day that was read, the track's own date. */
  dayYmd: string | null;
  drivers: PracticeFieldDriver[];
  /** Plain words for an empty or failed look; null when the list speaks for itself. */
  hint: string | null;
};

/** Which sites this track's practice can be read from, LiveRC first. */
export function practiceFieldSourcesForTrack(track: {
  liveRcUrl?: string | null;
  speedhiveUrl?: string | null;
}): PracticeFieldSource[] {
  const out: PracticeFieldSource[] = [];
  if (track.liveRcUrl?.trim() && normalizeLiveRcTrackOrigin(track.liveRcUrl)) out.push("liverc");
  if (track.speedhiveUrl?.trim() && practiceLocationIdFromTrackUrl(track.speedhiveUrl)) out.push("mylaps");
  return out;
}

export function isPracticeDayYmd(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export async function loadLiveRcPracticeField(input: {
  userId: string;
  trackLiveRcUrl: string;
  dayYmd: string;
}): Promise<PracticeFieldResult> {
  const base = { source: "liverc" as const, dayYmd: input.dayYmd, drivers: [] };
  const origin = normalizeLiveRcTrackOrigin(input.trackLiveRcUrl);
  if (!origin) return { ...base, hint: "This track's LiveRC link doesn't look right." };

  const indexUrl = buildPracticeSessionListUrl(origin, input.dayYmd);
  const fetched = await fetchUrlText(indexUrl);
  if (!fetched.ok) return { ...base, hint: "Couldn't reach LiveRC just now." };

  const drivers = groupLiveRcPracticeRows(extractPracticeSessions(fetched.text, indexUrl));
  const [liveName, chips] = await Promise.all([
    getLiveRcDriverNameSetting(input.userId).catch(() => null),
    getSpeedhiveTransponderNumbersForUser(input.userId).catch(() => [] as number[]),
    markAlreadyImported(input.userId, drivers),
  ]);
  const nameNorm = liveName?.trim() ? normalizeLiveRcDriverNameForMatch(liveName) : "";
  for (const d of drivers) {
    d.isViewer =
      (d.transponder != null && chips.includes(Number(d.transponder))) ||
      (nameNorm !== "" && d.siteName != null && liveRcNameMatchesConfigured(d.siteName, nameNorm));
  }
  return { ...base, drivers, hint: null };
}

export async function loadMylapsPracticeField(input: {
  userId: string;
  trackSpeedhiveUrl: string;
}): Promise<PracticeFieldResult> {
  const base = { source: "mylaps" as const, dayYmd: null, drivers: [] };
  const locationId = practiceLocationIdFromTrackUrl(input.trackSpeedhiveUrl);
  if (!locationId) return { ...base, hint: "This track has no MYLAPS practice page saved." };

  try {
    const location = await fetchPracticeLocation(locationId);
    const activities = await fetchPracticeLocationActivities(locationId, {
      count: MYLAPS_RECENT_ACTIVITIES,
      sport: location?.sport ?? "RC",
    });
    const drivers = groupMylapsActivities(activities);
    const [names, chips] = await Promise.all([
      getSpeedhiveDriverNamesForUser(input.userId).catch(() => [] as string[]),
      getSpeedhiveTransponderNumbersForUser(input.userId).catch(() => [] as number[]),
    ]);
    const nameNorms = normalizeSpeedhiveDriverNamesForMatch(names);
    for (const d of drivers) {
      d.isViewer =
        (d.transponder != null && chips.includes(Number(d.transponder))) ||
        (d.siteName != null && nameNorms.length > 0 && speedhiveDriverNameMatchesAny(d.siteName, nameNorms));
    }
    return { ...base, drivers, hint: null };
  } catch {
    // The raw error helps nobody standing at a track.
    return { ...base, hint: "Couldn't reach MYLAPS just now." };
  }
}

/** A session already in the asker's library opens from there — no second trip to the timing site. */
async function markAlreadyImported(userId: string, drivers: PracticeFieldDriver[]): Promise<void> {
  const urls = drivers.flatMap((d) => (d.sessions ?? []).map((s) => s.sessionUrl));
  if (urls.length === 0) return;
  const existing = await prisma.importedLapTimeSession.findMany({
    where: { userId, sourceUrl: { in: urls }, hiddenAt: null },
    select: { id: true, sourceUrl: true },
  });
  if (existing.length === 0) return;
  const byUrl = new Map(existing.map((e) => [e.sourceUrl.trim(), e.id]));
  for (const d of drivers) {
    for (const s of d.sessions ?? []) s.importedSessionId = byUrl.get(s.sessionUrl.trim()) ?? null;
  }
}
