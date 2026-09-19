import type { LapUrlParseResult, LapUrlSessionDriver } from "@/lib/lapUrlParsers/types";
import { realLaps } from "@/lib/videoAnalysis/findCrossings/fromSession";
import type {
  DriverRole,
  DriverSlot,
  ManualDriver,
  ManualDriverLap,
  ManualTimingSession,
  ManualVideoSessionV2,
  SelectedLaps,
} from "./types";
import { newTimingSessionId } from "./types";
import { parseViewCropNorm } from "./videoViewCrop";

export function driversFromParseResult(
  parsed: LapUrlParseResult,
  primaryDriverName?: string | null
): ManualDriver[] {
  const sd = parsed.sessionDrivers ?? [];
  if (sd.length === 0 && parsed.laps.length > 0) {
    return [
      {
        key: "primary",
        driverName: primaryDriverName ?? "You",
        normalizedName: "primary",
        role: "me",
        laps: parsed.laps.map((t, i) => ({
          lapNumber: i + 1,
          lapTimeSec: t,
          isIncluded: true,
        })),
      },
    ];
  }

  const normPrimary = primaryDriverName?.trim().toLowerCase() || null;
  let foundMe = false;
  return sd.map((d, idx) => {
    const laps = lapsFromSessionDriver(d);
    // Everyone in the imported heat starts as nobody. Defaulting them to "competitor" here is what
    // put fifteen drivers in a slot meant for one, and made the rival a matter of list order.
    let role: DriverSlot = "other";
    if (normPrimary) {
      const isMe =
        d.normalizedName.toLowerCase() === normPrimary ||
        d.driverName.toLowerCase() === normPrimary ||
        d.normalizedName.toLowerCase().includes(normPrimary) ||
        d.driverName.toLowerCase().includes(normPrimary);
      if (isMe && !foundMe) {
        role = "me";
        foundMe = true;
      }
    } else if (idx === 0) {
      role = "me";
      foundMe = true;
    }
    return {
      key: d.driverId || d.id || `d${idx}`,
      driverName: d.driverName,
      normalizedName: d.normalizedName,
      role,
      laps,
    } as ManualDriver;
  });
}

/** LiveRC practice pages reuse the same parser driver id — scope keys per timing session. */
export function namespaceSessionDriverKeys(
  sessionId: string,
  drivers: ManualDriver[]
): ManualDriver[] {
  return drivers.map((d) => ({
    ...d,
    key: `${sessionId}::${d.key}`,
  }));
}

export function timingSessionFromParseResult(
  parsed: LapUrlParseResult,
  sourceUrl: string,
  primaryDriverName?: string | null,
  label?: string
): ManualTimingSession {
  const sessionId = newTimingSessionId();
  const drivers = namespaceSessionDriverKeys(
    sessionId,
    driversFromParseResult(parsed, primaryDriverName)
  );
  return {
    sessionId,
    label: label ?? sessionLabelFromUrl(sourceUrl),
    sourceUrl,
    // Carried so the screen can say whether this person was even on track while the camera was
    // running. LiveRC prints it to the minute, which is nowhere near enough to sync anybody —
    // it is a sanity check on the chip, never a source of timing.
    sessionCompletedAtIso: parsed.sessionCompletedAtIso ?? null,
    isOnVideo: true,
    drivers,
    sync: {},
  };
}

/**
 * Seat one added link's driver beside the people already on the video.
 *
 * A practice link is one person, so there is nothing to pick: whoever the page is about takes the
 * next free seat. When the link is a race result the whole field arrives at once, so the driver
 * the page belongs to takes the seat and the rest stay "other" — available to the field matcher,
 * but not somebody the analysis is about until they are asked for.
 */
export function seatAddedSession(
  added: ManualTimingSession,
  role: DriverRole,
  driverKey?: string
): ManualTimingSession {
  const key =
    driverKey ??
    added.drivers.find((d) => d.role === "me")?.key ??
    added.drivers[0]?.key ??
    "";
  return {
    ...added,
    isOnVideo: true,
    drivers: added.drivers.map((d) => ({
      ...d,
      role: d.key === key ? role : ("other" as const),
    })),
  };
}

/** How far apart two sessions' clocks can be before they cannot be the same piece of footage. */
const SESSION_CLASH_SLOP_SEC = 15 * 60;

/** Roughly when a session was on track, from the timing page's clock and its own lap times. */
function sessionWindow(ts: ManualTimingSession): { fromSec: number; toSec: number } | null {
  if (!ts.sessionCompletedAtIso) return null;
  const at = Date.parse(ts.sessionCompletedAtIso);
  if (!Number.isFinite(at)) return null;
  const longest = Math.max(
    0,
    ...ts.drivers.map((d) => d.laps.reduce((t, l) => t + Math.max(0, l.lapTimeSec), 0))
  );
  // A practice page's stamp is the session's start, to the second (`wallClock.ts` leans on that);
  // a race page's is looser and may be either end of the heat. This check serves both, so the
  // window reaches a session's length either side rather than pretending to know which.
  const sec = at / 1000;
  return { fromSec: sec - longest, toSec: sec + longest };
}

/**
 * A plain-language warning when an added link cannot have been filmed with the others.
 *
 * Never a refusal. The definitive test of whether somebody is in the video is the scan finding
 * them — this just catches the far commoner mistake of pasting a link from a different part of
 * the day. (A practice stamp is exact to the second, and `wallClock.ts` uses it for placement;
 * this check keeps a wide margin because it has to serve race stamps too.)
 */
export function sessionTimeClash(
  sessions: ManualTimingSession[],
  addedSessionId: string
): string | null {
  const added = sessions.find((s) => s.sessionId === addedSessionId);
  const addedWindow = added ? sessionWindow(added) : null;
  if (!added || !addedWindow) return null;

  for (const other of sessions) {
    if (other.sessionId === addedSessionId || !other.isOnVideo) continue;
    const w = sessionWindow(other);
    if (!w) continue;
    const gap = Math.max(addedWindow.fromSec - w.toSec, w.fromSec - addedWindow.toSec);
    if (gap > SESSION_CLASH_SLOP_SEC) {
      return `That session ran about ${Math.round(gap / 60)} minutes away from ${other.label} — check it is the right one.`;
    }
  }
  return null;
}

/** Every seat already spoken for, so the next link knows which one it gets. */
export function usedRoles(sessions: ManualTimingSession[]): DriverRole[] {
  const out: DriverRole[] = [];
  for (const ts of sessions) {
    for (const d of ts.drivers) {
      if (d.role !== "other" && !out.includes(d.role)) out.push(d.role);
    }
  }
  return out;
}

export function sessionLabelFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.split("/").filter(Boolean).slice(-2).join("/");
    return path || u.hostname;
  } catch {
    return url.slice(0, 40);
  }
}

/**
 * Who this analysis is about, before the driver has said.
 *
 * "Me" is a real match — the driver's saved timing name against the field — but the rival never
 * was. A heat import brings fifteen drivers and this used to hand back whichever one the timing
 * site listed first, which then became the car every sector time was measured against without
 * anybody choosing it. A rival is now only ever returned when it is genuinely known: either the
 * driver has already picked one, or the session holds exactly two people and there is nothing
 * to pick between.
 */
export function defaultDriverKeys(drivers: ManualDriver[]): {
  meKey: string;
  competitorKey: string;
} {
  if (drivers.length === 0) return { meKey: "", competitorKey: "" };
  const me = drivers.find((d) => d.role === "me");
  const competitor = drivers.find((d) => d.role === "competitor" && d.key !== me?.key);
  if (me) return { meKey: me.key, competitorKey: competitor?.key ?? "" };
  // Two people and no name match: there is nothing to pick between, so position decides both.
  if (drivers.length === 2) return { meKey: drivers[0]!.key, competitorKey: drivers[1]!.key };
  return { meKey: drivers[0]!.key, competitorKey: "" };
}

function lapsFromSessionDriver(d: LapUrlSessionDriver): ManualDriverLap[] {
  const rows = d.laps ?? [];
  return rows.map((t, i) => ({
    lapNumber: i + 1,
    lapTimeSec: t,
    isIncluded: true,
  }));
}

export function driversFromRunImportedLapSets(
  sets: Array<{
    sourceUrl?: string | null;
    sessionCompletedAt?: Date | string | null;
    driverId: string | null;
    driverName: string;
    normalizedName: string;
    isPrimaryUser: boolean;
    laps: Array<{ lapNumber: number; lapTimeSeconds: number; isIncluded: boolean }>;
  }>
): ManualDriver[] {
  let hasPrimary = false;
  const drivers: ManualDriver[] = sets.map((s) => {
    const role = s.isPrimaryUser && !hasPrimary ? "me" : "competitor";
    if (role === "me") hasPrimary = true;
    return {
      key: s.driverId ?? s.normalizedName,
      driverName: s.driverName,
      normalizedName: s.normalizedName,
      role,
      laps: s.laps
        .filter((l) => l.isIncluded)
        .map((l) => ({
          lapNumber: l.lapNumber,
          lapTimeSec: l.lapTimeSeconds,
          isIncluded: true,
        })),
    };
  });
  if (!hasPrimary && drivers.length > 0) {
    drivers[0]!.role = "me";
    for (let i = 1; i < drivers.length; i++) drivers[i]!.role = "competitor";
  }
  return drivers;
}

export function timingSessionsFromRunImportedLapSets(
  sets: Array<{
    sourceUrl?: string | null;
    sessionCompletedAt?: Date | string | null;
    driverId: string | null;
    driverName: string;
    normalizedName: string;
    isPrimaryUser: boolean;
    laps: Array<{ lapNumber: number; lapTimeSeconds: number; isIncluded: boolean }>;
  }>
): ManualTimingSession[] {
  const byUrl = new Map<string, typeof sets>();
  for (const s of sets) {
    const key = (s.sourceUrl?.trim() || "run") + (s.sessionCompletedAt?.toString() ?? "");
    const list = byUrl.get(key) ?? [];
    list.push(s);
    byUrl.set(key, list);
  }

  return [...byUrl.entries()].map(([key, group]) => {
    const first = group[0]!;
    const sessionId = newTimingSessionId();
    const completed =
      first.sessionCompletedAt instanceof Date
        ? first.sessionCompletedAt.toISOString()
        : typeof first.sessionCompletedAt === "string"
          ? first.sessionCompletedAt
          : null;
    return {
      sessionId,
      label: first.sourceUrl ? sessionLabelFromUrl(first.sourceUrl) : "Run session",
      sourceUrl: first.sourceUrl ?? null,
      sessionCompletedAtIso: completed,
      isOnVideo: true,
      drivers: namespaceSessionDriverKeys(sessionId, driversFromRunImportedLapSets(group)),
      sync: {},
    };
  });
}

/**
 * Which timing sessions this video is being read against.
 *
 * A session is on the video when somebody in it holds a seat — "me" or a rival. That used to be
 * the first session containing "me" and nothing else, which was right while an analysis could
 * only ever be about two drivers in one heat. A LiveRC practice link carries exactly one driver,
 * so several people off practice footage means several sessions, and demoting all but the first
 * is what made every extra link load and then do nothing.
 */
export function applyDefaultIsOnVideo(sessions: ManualTimingSession[]): ManualTimingSession[] {
  const seen = new Set<string>();
  return sessions.map((ts) => {
    const claimed = ts.drivers.filter((d) => d.role !== "other" && !seen.has(d.role));
    for (const d of claimed) seen.add(d.role);
    return { ...ts, isOnVideo: claimed.length > 0 };
  });
}

/**
 * Stamp the two chosen drivers and demote everybody else.
 *
 * Keeping an unlisted driver's previous role is what let a whole field read as the competitor:
 * "competitor" was the default role on every imported row, so every one of them answered to a
 * lookup for the rival and the first in the list won. Exactly one driver holds each slot now.
 */
export function setDriverRoles(
  drivers: ManualDriver[],
  meKey: string,
  competitorKey: string
): ManualDriver[] {
  return drivers.map((d) => ({
    ...d,
    role: d.key === meKey ? "me" : d.key && d.key === competitorKey ? "competitor" : "other",
  }));
}

export function pickBestNLapNumbers(laps: ManualDriverLap[], n = 3): number[] {
  // realLaps first: a race's opening lap is timed from the start line, so it is a fragment, and
  // sorting by lap time would otherwise offer it as the driver's best lap.
  return realLaps([...laps])
    .sort((a, b) => a.lapTimeSec - b.lapTimeSec)
    .slice(0, n)
    .map((l) => l.lapNumber);
}

export function allIncludedLapNumbers(laps: ManualDriverLap[]): number[] {
  return [...laps]
    .filter((l) => l.isIncluded !== false && l.lapTimeSec > 0)
    .sort((a, b) => a.lapNumber - b.lapNumber)
    .map((l) => l.lapNumber);
}

/**
 * One driver per seat, across the whole analysis, whatever the stored session says.
 *
 * Sessions saved before "other" existed have the entire imported field sitting in the rival's
 * slot, so a lookup for the competitor answers with whoever the timing site listed first. Read
 * back through here they keep that same first driver — no silent change of who the analysis is
 * about — and everyone else steps out of the way so the picker can show the truth.
 *
 * This walks the sessions, not one session's drivers, because a seat is unique to the analysis:
 * the scan files its work under `role:lap:line` with no session in it, so the same role in two
 * timing sessions would be two people writing into one slot.
 */
function oneDriverPerRole(sessions: ManualTimingSession[]): ManualTimingSession[] {
  const taken = new Set<string>();
  return sessions.map((ts) => ({
    ...ts,
    drivers: ts.drivers.map((d) => {
      if (d.role === "other" || taken.has(d.role)) return { ...d, role: "other" as const };
      taken.add(d.role);
      return d;
    }),
  }));
}

export function normalizeManualSession(session: ManualVideoSessionV2): ManualVideoSessionV2 {
  const timingSessions = oneDriverPerRole(session.timingSessions).map((ts) => ({
    ...ts,
    drivers: ts.drivers.map((d) => ({
      ...d,
      laps: d.laps.map((l) => ({ ...l, isIncluded: l.isIncluded !== false })),
    })),
  }));
  const viewCropNorm = session.viewCropNorm ? parseViewCropNorm(session.viewCropNorm) : undefined;
  return fillDefaultLapSelection({
    ...session,
    timingSessions,
    ...(viewCropNorm ? { viewCropNorm } : { viewCropNorm: undefined }),
  });
}

/** Every seat currently held, with the driver holding it. */
function seatedDrivers(session: ManualVideoSessionV2): Array<[DriverRole, ManualDriver]> {
  const out: Array<[DriverRole, ManualDriver]> = [];
  const seen = new Set<string>();
  for (const ts of session.timingSessions) {
    if (!ts.isOnVideo) continue;
    for (const d of ts.drivers) {
      if (d.role === "other" || seen.has(d.role)) continue;
      seen.add(d.role);
      out.push([d.role, d]);
    }
  }
  return out;
}

/**
 * Give every driver their quickest three laps, replacing whatever was chosen before.
 *
 * For a fresh timing load, where nobody has chosen anything and the old choices name laps that
 * belong to a different session entirely.
 */
export function applyTop3LapSelection(session: ManualVideoSessionV2): ManualVideoSessionV2 {
  const selectedLaps: SelectedLaps = { me: [], competitor: [] };
  for (const [role, driver] of seatedDrivers(session)) {
    selectedLaps[role] = pickBestNLapNumbers(driver.laps, 3);
  }
  return { ...session, selectedLaps };
}

/**
 * Give a driver their quickest three laps only when nobody has chosen for them yet.
 *
 * Normalisation runs on every save, and it used to call the resetting version above — so tapping
 * a lap chip put the choice on screen, and half a second later the save handed back the top three
 * again and the tap undid itself. A newly added driver still needs a starting selection, which is
 * the half of that behaviour worth keeping.
 */
export function fillDefaultLapSelection(session: ManualVideoSessionV2): ManualVideoSessionV2 {
  const prev = session.selectedLaps;
  const selectedLaps: SelectedLaps = { me: prev.me ?? [], competitor: prev.competitor ?? [] };
  for (const [role, driver] of seatedDrivers(session)) {
    const chosen = prev[role];
    selectedLaps[role] = chosen?.length ? chosen : pickBestNLapNumbers(driver.laps, 3);
  }
  return { ...session, selectedLaps };
}

export const applyDefaultLapSelection = applyTop3LapSelection;
export const applyBest3Selection = applyTop3LapSelection;

export function setLapIncluded(
  session: ManualVideoSessionV2,
  sessionId: string,
  role: DriverRole,
  lapNumber: number,
  included: boolean
): ManualVideoSessionV2 {
  const timingSessions = session.timingSessions.map((ts) => {
    if (ts.sessionId !== sessionId) return ts;
    return {
      ...ts,
      drivers: ts.drivers.map((d) => {
        if (d.role !== role) return d;
        return {
          ...d,
          laps: d.laps.map((l) =>
            l.lapNumber === lapNumber ? { ...l, isIncluded: included } : l
          ),
        };
      }),
    };
  });
  // Only this lap moves. Resetting every driver to their quickest three here meant that dropping
  // one bad lap silently threw away every other choice on the screen.
  const chosen = session.selectedLaps[role] ?? [];
  const selectedLaps = included
    ? session.selectedLaps
    : { ...session.selectedLaps, [role]: chosen.filter((n) => n !== lapNumber) };
  return fillDefaultLapSelection({
    ...session,
    timingSessions,
    selectedLaps: selectedLaps as SelectedLaps,
  });
}

export function bestIncludedLapNumbers(
  session: ManualVideoSessionV2,
  sessionId: string,
  role: DriverRole,
  n = 3
): number[] {
  const ts = session.timingSessions.find((s) => s.sessionId === sessionId);
  const driver = ts?.drivers.find((d) => d.role === role);
  if (!driver) return [];
  return pickBestNLapNumbers(driver.laps, n);
}

/**
 * Reloading the timing must not throw away the work that hangs off it.
 *
 * Every marking session's marks, and its sync anchor, are keyed to a `sessionId` minted when the
 * timing was imported. Import the same timing again — a second attempt, a corrected URL, more
 * laps recorded since — and the old id was replaced by a new one, so every mark and the anchor
 * were left pointing at a session that no longer existed. They are not deleted: they sit in the
 * file, invisible, and the flow falls back to guessing.
 *
 * Found on the Bendigo job of 2026-09-01 (cmti09r7…), which held 86 marks across two dead session
 * ids while the mark step placed its dots by splitting the lap into equal pieces — S1's dot landed
 * on the start/finish line, with the car still coming out of the last corner.
 *
 * So: when a reload is plainly the same session, it keeps the same identity.
 */

/** Two lap lists are the same session's if the shorter is a prefix of the longer, to the hundredth. */
function lapsAgree(a: ManualDriverLap[], b: ManualDriverLap[]): boolean {
  const n = Math.min(a.length, b.length);
  // One lap in common proves nothing — plenty of laps are 15.1s.
  if (n < 2) return false;
  const byNumber = (xs: ManualDriverLap[]) =>
    [...xs].sort((x, y) => x.lapNumber - y.lapNumber);
  const A = byNumber(a);
  const B = byNumber(b);
  for (let i = 0; i < n; i++) {
    if (A[i]!.lapNumber !== B[i]!.lapNumber) return false;
    if (Math.abs(A[i]!.lapTimeSec - B[i]!.lapTimeSec) > 0.02) return false;
  }
  return true;
}

function primaryLaps(s: ManualTimingSession): ManualDriverLap[] {
  return (s.drivers.find((d) => d.role === "me") ?? s.drivers[0])?.laps ?? [];
}

/** Is this freshly loaded session the one that was already here? */
export function sameTimingSession(prev: ManualTimingSession, next: ManualTimingSession): boolean {
  const bothUrls = prev.sourceUrl && next.sourceUrl;
  if (bothUrls && prev.sourceUrl !== next.sourceUrl) return false;
  if (!bothUrls && prev.label !== next.label) return false;
  return lapsAgree(primaryLaps(prev), primaryLaps(next));
}

export type ReconciledTiming = {
  sessions: ManualTimingSession[];
  /**
   * Sessions that were replaced rather than reloaded. Anything keyed to them — marks above all —
   * is now stale, and the caller must clear it rather than leave it dangling.
   */
  replacedSessionIds: string[];
};

/**
 * Give each reloaded session the identity it already had, where it is the same session.
 *
 * What is carried: the id (so marks and the compare still resolve) and the sync (so a driver who
 * has already lined the video up does not have to do it again). What is NOT carried: the laps and
 * drivers, which come fresh from the timing — reloading exists to pick up corrections.
 */
export function reconcileTimingSessions(
  previous: ManualTimingSession[],
  loaded: ManualTimingSession[]
): ReconciledTiming {
  const taken = new Set<string>();
  const sessions = loaded.map((next) => {
    const prev = previous.find((p) => !taken.has(p.sessionId) && sameTimingSession(p, next));
    if (!prev) return next;
    taken.add(prev.sessionId);
    return {
      ...next,
      sessionId: prev.sessionId,
      // Driver keys are namespaced by session id, so they have to follow it.
      drivers: namespaceSessionDriverKeys(
        prev.sessionId,
        next.drivers.map((d) => ({ ...d, key: d.key.split("::").pop() ?? d.key }))
      ),
      sync: prev.sync,
    };
  });
  return {
    sessions,
    replacedSessionIds: previous.filter((p) => !taken.has(p.sessionId)).map((p) => p.sessionId),
  };
}
