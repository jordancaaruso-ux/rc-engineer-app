import type {
  AnchorKind,
  CompareAlignAt,
  DriverRole,
  ManualCompareState,
  ManualDriver,
  ManualSyncAnchor,
  ManualTimingSession,
  ManualVideoSessionV2,
} from "./types";
import {
  anchorForRole,
  predictSfEndTime,
  predictSfStartTime,
  transponderSfSec,
} from "./sync";

export function findTimingSession(
  session: ManualVideoSessionV2,
  sessionId: string
): ManualTimingSession | undefined {
  return session.timingSessions.find((s) => s.sessionId === sessionId);
}

export function findDriverInSession(
  timingSession: ManualTimingSession,
  role: DriverRole
): ManualDriver | undefined {
  return timingSession.drivers.find((d) => d.role === role);
}

export function primaryTimingSession(session: ManualVideoSessionV2): ManualTimingSession | undefined {
  return session.timingSessions.find((s) => s.isOnVideo) ?? session.timingSessions[0];
}

/**
 * One person on the video: which seat they hold, whose timing they came from, and their laps.
 *
 * A race link puts everybody in one timing session, so both drivers share a `sessionId`. A
 * practice link carries exactly one driver, so several people means several sessions — and the
 * screen should not have to know which of the two it is looking at. `role` is unique across the
 * whole analysis either way, because that is what the scan files its work under.
 */
export type Participant = {
  role: DriverRole;
  sessionId: string;
  timingSession: ManualTimingSession;
  driver: ManualDriver;
};

/** Sort order for the chips and every list built from them: you first, then rivals as added. */
function roleRank(role: DriverRole): number {
  if (role === "me") return 0;
  if (role === "competitor") return 1;
  return Number(role.slice(1)) || 99;
}

/**
 * Everyone the video is being read for, across every timing session that is on it.
 *
 * Drivers in the slot "other" are excluded: a race import brings a whole heat, and the field
 * matcher wants all of them, but only the ones somebody actually chose get marks, laps and a
 * column on the compare.
 */
export function participants(session: ManualVideoSessionV2): Participant[] {
  const out: Participant[] = [];
  const seen = new Set<DriverRole>();
  for (const ts of session.timingSessions) {
    if (!ts.isOnVideo) continue;
    for (const driver of ts.drivers) {
      if (driver.role === "other") continue;
      // A role is a seat, and two people cannot share one. Should a saved file ever carry a
      // duplicate, the first session wins rather than the two silently overwriting each other.
      if (seen.has(driver.role)) continue;
      seen.add(driver.role);
      out.push({ role: driver.role, sessionId: ts.sessionId, timingSession: ts, driver });
    }
  }
  return out.sort((a, b) => roleRank(a.role) - roleRank(b.role));
}

export function findParticipant(
  session: ManualVideoSessionV2,
  role: DriverRole
): Participant | undefined {
  return participants(session).find((p) => p.role === role);
}

/** Any anchor on this session — the shared one, or a driver's own. */
export function anyAnchor(sync: ManualTimingSession["sync"]) {
  return sync.anchor ?? sync.anchorByRole?.me ?? sync.anchorByRole?.competitor;
}

/** First session marked on-video that has an SF anchor set — of any kind. */
export function referenceAnchoredSession(
  session: ManualVideoSessionV2
): ManualTimingSession | undefined {
  return session.timingSessions.find((s) => s.isOnVideo && anyAnchor(s.sync));
}

/**
 * The analysis has produced something to look at: at least one of your laps is marked over
 * every corner line on the session that is on the video, so a sector compare exists.
 * This is what "the analysis is already done" means when a session is reopened — the numbers
 * come from the marks, so they can be shown without the video (which usually lives on the
 * phone and was never uploaded). Such a session must never land back on "Pick the video" and
 * walk the driver through timing, lines and sync again for work it already holds.
 *
 * One complete lap, not every lap: the detector marks ten laps in a pass and leaves the odd
 * crossing it could not see, and that session is still an analysis, not a half-done one.
 *
 * ANY lap of yours, not a chosen one. Laps used to be ticked by hand on the timing step and only
 * those counted; the scan now reads your quickest ten on its own (2026-09-02), so a whole lap
 * anywhere in the file is the analysis, whatever a stale `selectedLaps` still says.
 */
export function hasMarkedLap(session: ManualVideoSessionV2, lineKeys: string[]): boolean {
  const mine = findParticipant(session, "me") ?? undefined;
  const primary = mine?.timingSession ?? primaryTimingSession(session);
  if (!primary) return false;
  const corners = lineKeys.filter((k) => k !== "sf");
  if (corners.length === 0) return false;
  const laps = new Set<number>();
  for (const m of session.marks) {
    if (m.sessionId === primary.sessionId && m.driverRole === "me") laps.add(m.lapNumber);
  }
  return [...laps].some((lapNumber) =>
    corners.every((lineKey) =>
      session.marks.some(
        (m) =>
          m.sessionId === primary.sessionId &&
          m.driverRole === "me" &&
          m.lapNumber === lapNumber &&
          m.lineKey === lineKey
      )
    )
  );
}

/**
 * Make somebody else "you".
 *
 * The first link pasted used to be the driver, full stop: paste a rival's practice page first
 * and your own second, and every sector time was built on the wrong car with no way to say so.
 * The two people change places and everything already filed under either seat goes with them —
 * marks, chosen laps, anchors and per-lap pins, the saved scan, the picker record. Nothing is
 * thrown away, because a role is only a label for a seat; the driver in it is what the data is
 * about.
 */
export function swapDriverRoles(
  session: ManualVideoSessionV2,
  a: DriverRole,
  b: DriverRole
): ManualVideoSessionV2 {
  if (a === b) return session;
  const swap = <T extends string>(r: T): T => (r === a ? (b as T) : r === b ? (a as T) : r);
  // Per-lap pins are keyed `${role}:${lap}` (see `lapSfKey`).
  const swapKeys = (rec: Record<string, number> | undefined) => {
    if (!rec) return rec;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(rec)) {
      const i = k.indexOf(":");
      out[i < 0 ? k : `${swap(k.slice(0, i))}${k.slice(i)}`] = v;
    }
    return out;
  };
  const swapAnchor = (x: ManualSyncAnchor | undefined) =>
    x ? { ...x, driverRole: swap(x.driverRole) } : x;

  const timingSessions = session.timingSessions.map((ts) => {
    const anchorByRole = ts.sync.anchorByRole
      ? Object.fromEntries(
          Object.entries(ts.sync.anchorByRole).map(([r, x]) => [swap(r), swapAnchor(x)])
        )
      : undefined;
    // Only the keys the session already carries are written back, so a swap-and-swap-back is
    // the file it started from, byte for byte.
    return {
      ...ts,
      drivers: ts.drivers.map((d) => ({ ...d, role: swap(d.role) })),
      sync: {
        ...ts.sync,
        ...(ts.sync.anchor ? { anchor: swapAnchor(ts.sync.anchor) } : {}),
        ...(anchorByRole ? { anchorByRole } : {}),
        ...(ts.sync.perLapSfStart ? { perLapSfStart: swapKeys(ts.sync.perLapSfStart) } : {}),
        ...(ts.sync.perLapSfEnd ? { perLapSfEnd: swapKeys(ts.sync.perLapSfEnd) } : {}),
      },
    };
  });

  const selected = { ...session.selectedLaps } as Record<string, number[] | undefined>;
  const selA = selected[a];
  const selB = selected[b];
  selected[a] = selB;
  selected[b] = selA;
  const selectedLaps = {
    ...selected,
    me: selected.me ?? [],
    competitor: selected.competitor ?? [],
  } as ManualVideoSessionV2["selectedLaps"];

  const slot = (s: ManualCompareState["my"]) => (s ? { ...s, role: swap(s.role) } : s);

  return {
    ...session,
    timingSessions,
    selectedLaps,
    marks: session.marks.map((m) => ({ ...m, driverRole: swap(m.driverRole) })),
    compare: { ...session.compare, my: slot(session.compare.my), competitor: slot(session.compare.competitor) },
    ...(session.lastScan
      ? {
          lastScan: {
            ...session.lastScan,
            rows: session.lastScan.rows.map((r) => ({
              ...r,
              driverRole: swap(r.driverRole),
              // The field matcher names a seated driver by their role.
              ...(r.claimedBy ? { claimedBy: { ...r.claimedBy, key: swap(r.claimedBy.key) } } : {}),
            })),
          },
        }
      : {}),
    ...(session.lastIdentify
      ? { lastIdentify: { ...session.lastIdentify, driverRole: swap(session.lastIdentify.driverRole) } }
      : {}),
  };
}

export function legacyFlatDrivers(session: ManualVideoSessionV2): ManualDriver[] {
  return primaryTimingSession(session)?.drivers ?? [];
}

export function legacyFlatSync(session: ManualVideoSessionV2) {
  return primaryTimingSession(session)?.sync ?? {};
}

function alignKind(alignAt: CompareAlignAt): AnchorKind {
  return alignAt === "sf_finish" ? "sf_finish" : "sf_start";
}

/**
 * Map a lap SF crossing to video seconds.
 * On-video anchored sessions use the anchor walk; off-video sessions map via the reference anchor.
 */
export function videoTimeAtLapSf(
  session: ManualVideoSessionV2,
  sessionId: string,
  role: DriverRole,
  lapNumber: number,
  alignAt: CompareAlignAt = "sf_finish"
): number | null {
  const ts = findTimingSession(session, sessionId);
  if (!ts) return null;
  const driver = findDriverInSession(ts, role);
  if (!driver) return null;

  const kind = alignKind(alignAt);
  const predict = kind === "sf_finish" ? predictSfEndTime : predictSfStartTime;

  // A driver placed by their OWN anchor is placed exactly; otherwise the session's shared
  // anchor still walks them, which is right whenever the field started together.
  if (ts.isOnVideo && (anchorForRole(ts.sync, role) ?? anyAnchor(ts.sync))) {
    return predict(driver, lapNumber, ts);
  }

  const ref = referenceAnchoredSession(session);
  const anchor = ref ? anyAnchor(ref.sync) : undefined;
  if (!ref || !anchor) return null;

  const refDriver = findDriverInSession(ref, anchor.driverRole);
  if (!refDriver) return null;

  const targetTrans = transponderSfSec(driver, lapNumber, kind);
  const anchorTrans = transponderSfSec(refDriver, anchor.lapNumber, anchor.anchorKind);
  if (targetTrans == null || anchorTrans == null) return null;

  const anchorVideoT = anchor.videoTimeSec + (ref.sync.globalOffsetSec ?? 0);
  return anchorVideoT + (targetTrans - anchorTrans);
}

export type CompareSfAlignment = {
  bottomSec: number;
  ghostSec: number;
  offsetSec: number;
};

/** Bottom = my lap at SF; ghost = competitor lap at SF; offset = ghost − bottom. */
export function getCompareSfAlignment(
  session: ManualVideoSessionV2,
  compare: ManualCompareState
): CompareSfAlignment | null {
  const { my, competitor, alignAt = "sf_finish", offsetNudgeSec = 0 } = compare;
  if (!my || !competitor) return null;

  const bottomSec = videoTimeAtLapSf(session, my.sessionId, my.role, my.lapNumber, alignAt);
  const ghostSec = videoTimeAtLapSf(
    session,
    competitor.sessionId,
    competitor.role,
    competitor.lapNumber,
    alignAt
  );
  if (bottomSec == null || ghostSec == null) return null;

  return {
    bottomSec,
    ghostSec,
    offsetSec: ghostSec - bottomSec + offsetNudgeSec,
  };
}

export function computeCompareOffsetSec(
  session: ManualVideoSessionV2,
  compare: ManualCompareState
): number | null {
  return getCompareSfAlignment(session, compare)?.offsetSec ?? null;
}

/**
 * Tie one driver's timing clock to the video clock.
 *
 * Where the anchor is written decides who it places. In a race everybody leaves on the tone, so
 * the driver's own anchor becomes the session's shared one and the whole field walks from it; a
 * rival's is stored against the rival alone, because two people who did not start together share
 * nothing. Somebody added from their own practice link is alone in their timing session, so their
 * anchor is that session's anchor — there is nobody else in it for it to speak for.
 */
/** A driver's anchor moved by more than this is a different placement, not a nudge. */
const REPLACED_ANCHOR_SEC = 1.0;

/** Video time of this driver's lap 1 start under an anchor, walking their own lap times. */
function lapOneStartUnder(driver: ManualDriver, anchor: ManualSyncAnchor): number {
  let t = anchor.videoTimeSec;
  for (const l of [...driver.laps].sort((a, b) => a.lapNumber - b.lapNumber)) {
    if (l.lapNumber < anchor.lapNumber) t -= l.lapTimeSec;
    else if (l.lapNumber === anchor.lapNumber && anchor.anchorKind === "sf_finish") t -= l.lapTimeSec;
  }
  return t;
}

export function setParticipantAnchor(
  session: ManualVideoSessionV2,
  role: DriverRole,
  anchor: ManualSyncAnchor
): ManualVideoSessionV2 {
  const target = findParticipant(session, role);
  if (!target) return session;
  const ts = target.timingSession;
  const aloneInSession = ts.drivers.filter((d) => d.role !== "other").length === 1;
  // A driver placed somewhere else is a driver whose scanned marks were found somewhere else:
  // every one of them was searched for around the old placement and would be taken as truth by
  // the next scan (a mark is a fixed row to the fit and the vote). On IMG_4521 (2026-09-03) a
  // driver anchored 35s early carried twelve such marks; moving him to the clock's placement and
  // keeping them would have graded the right scan against the wrong one. Hand marks stay — the
  // driver saw those.
  const before = ts.sync.anchorByRole?.[role] ?? (role === "me" ? ts.sync.anchor : undefined);
  const replaced =
    before != null &&
    Math.abs(lapOneStartUnder(target.driver, before) - lapOneStartUnder(target.driver, anchor)) >
      REPLACED_ANCHOR_SEC;
  const marks = replaced
    ? session.marks.filter((m) => !(m.driverRole === role && m.sessionId === ts.sessionId && m.source))
    : session.marks;
  return {
    ...session,
    marks,
    timingSessions: session.timingSessions.map((s) =>
      s.sessionId !== ts.sessionId
        ? s
        : {
            ...s,
            isOnVideo: true,
            sync: {
              ...s.sync,
              // Per-lap pins were measured against the old placement; they are not true of the new one.
              perLapSfStart: undefined,
              perLapSfEnd: undefined,
              ...(role === "me" || aloneInSession ? { anchor } : {}),
              anchorByRole: { ...s.sync.anchorByRole, [role]: anchor },
            },
          }
    ),
  };
}

/**
 * Take one person off the video, and everything that was only true because they were on it.
 *
 * Their marks, their chosen laps and any compare slot pointing at them all name a driver that no
 * longer exists — left behind they read as somebody else's work on the next scan. The timing
 * session goes too when nobody else in it holds a seat, which for a practice link is always.
 */
export function removeParticipant(
  session: ManualVideoSessionV2,
  role: DriverRole
): ManualVideoSessionV2 {
  const target = findParticipant(session, role);
  if (!target) return session;

  const timingSessions: ManualTimingSession[] = [];
  for (const ts of session.timingSessions) {
    if (ts.sessionId !== target.sessionId) {
      timingSessions.push(ts);
      continue;
    }
    const drivers = ts.drivers.map((d) => (d.role === role ? { ...d, role: "other" as const } : d));
    if (drivers.some((d) => d.role !== "other")) timingSessions.push({ ...ts, drivers });
  }

  const selectedLaps = { ...session.selectedLaps };
  delete selectedLaps[role];
  const keepSlot = (s: ManualCompareState["my"]) => (s && s.role === role ? null : s);

  return {
    ...session,
    timingSessions,
    selectedLaps: { ...selectedLaps, me: selectedLaps.me ?? [], competitor: selectedLaps.competitor ?? [] },
    marks: session.marks.filter((m) => m.driverRole !== role),
    compare: {
      ...session.compare,
      my: keepSlot(session.compare.my),
      competitor: keepSlot(session.compare.competitor),
    },
    // The saved scan names roles too; a stale row would be replayed onto whoever takes the seat next.
    lastScan: session.lastScan
      ? { ...session.lastScan, rows: session.lastScan.rows.filter((r) => r.driverRole !== role) }
      : undefined,
  };
}

export function updateTimingSession(
  session: ManualVideoSessionV2,
  sessionId: string,
  patch: Partial<ManualTimingSession>
): ManualVideoSessionV2 {
  return {
    ...session,
    timingSessions: session.timingSessions.map((s) =>
      s.sessionId === sessionId ? { ...s, ...patch } : s
    ),
  };
}
