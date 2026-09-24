"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LapRow } from "@/lib/lapAnalysis";
import { applyMedianBandAutoExclude } from "@/lib/lapImport/autoExcludeOutlierLaps";
import { primaryLapRowsFromImportedPayload } from "@/lib/lapImport/fromPayload";
import { rawSessionDriversFromImportedPayload } from "@/lib/lapImport/importedIngestPlan";
import {
  formatDriverSessionLabel,
  importedSessionTimeForDisplay,
  resolveImportedSessionDisplayTimeIso,
  resolveImportedSessionHasWallClockTime,
  timingSourceFromParserId,
  timingSourceFromSourceUrl,
} from "@/lib/lapImport/labels";
import { importedSessionIsRaceResult } from "@/lib/practiceField/practiceField";

/** One entrant on a brought-in race sheet. */
export type ImportedLibraryDriver = {
  /** The sheet's own id for them ("sd-3") — the same one the session's own page uses. */
  id: string;
  name: string;
  laps: LapRow[];
  /** The viewer's own row, by the name their session is named for. */
  isViewer: boolean;
};

export type ImportedLibrarySession = {
  id: string;
  selectLabel: string;
  name: string;
  laps: LapRow[];
  sortTimeIso: string;
  trackName: string | null;
  /**
   * Which tab of the lap sheet it is filed under. A race is a LiveRC race result or a MyRCM sheet
   * (founder call, 2026-09-24); everything else — someone's practice, any MYLAPS session — is one
   * driver's laps and files under Practice, or under My runs when it is the viewer's.
   */
  kind: "practice" | "race";
  /**
   * The session time as the TRACK's clock, digits written as UTC, when the timing site gave one
   * (LiveRC, MyRCM). `sortTimeIso` is those same digits — printed in anyone's zone it lands ten
   * hours out in Melbourne, so the lap sheet turns this into a real instant before printing it.
   */
  trackClockIso: string | null;
  /**
   * Whose practice it is, as the practice list knew them when it was brought in — see
   * `/api/lap-time-sessions/[id]/practice-driver`. Null on anything brought in another way.
   */
  practiceTransponder: string | null;
  practiceSiteName: string | null;
  /** One of the viewer's runs this session is on. That run already carries these laps. */
  onRunId: string | null;
  /** The viewer's own: on one of their runs, or their name or chip on the sheet. */
  mine: boolean;
  /** Its name without a driver — "Run 3", a race's own name — as the library names it. */
  label: string | null;
  sourceUrl: string | null;
  /** A race's entrants with laps, in finishing order. Empty on anything that is not a race. */
  drivers: ImportedLibraryDriver[];
};

function practiceDriverFromPayload(parsedPayload: unknown): {
  transponder: string | null;
  siteName: string | null;
  trackName: string | null;
} {
  const hint =
    parsedPayload && typeof parsedPayload === "object"
      ? (parsedPayload as { sessionHint?: unknown }).sessionHint
      : null;
  const h = hint && typeof hint === "object" ? (hint as Record<string, unknown>) : {};
  return {
    transponder: typeof h.practiceTransponder === "string" && h.practiceTransponder ? h.practiceTransponder : null,
    siteName: typeof h.practiceSiteName === "string" && h.practiceSiteName ? h.practiceSiteName : null,
    trackName: typeof h.practiceTrackName === "string" && h.practiceTrackName ? h.practiceTrackName : null,
  };
}

type LibraryApiSession = {
  id: string;
  createdAt: string;
  sessionCompletedAt?: string | null;
  sourceUrl?: string | null;
  parserId?: string | null;
  trackName?: string | null;
  onRunId?: string | null;
  mine?: boolean;
  viewerDriverId?: string | null;
  label?: string | null;
  parsedPayload: unknown;
};

/**
 * Laps as the session's own page shows them: every driver's marshal laps and cut laps left out by
 * the same rule, so a column ticked here reads the same numbers as that sheet opened on its own.
 */
function sheetLapRows(times: readonly number[]): LapRow[] {
  return applyMedianBandAutoExclude(
    times.map((t, i) => ({ lapNumber: i + 1, lapTimeSeconds: t, isIncluded: true }))
  );
}

function lapsTotal(laps: readonly number[]): number {
  let sum = 0;
  for (const t of laps) sum += t;
  return sum;
}

/** A race sheet's entrants, most laps then least time first — the order its own page numbers them. */
function raceDrivers(parsedPayload: unknown, viewerDriverId: string | null): ImportedLibraryDriver[] {
  const raw = (rawSessionDriversFromImportedPayload(parsedPayload) ?? []).filter((d) => d.laps.length > 0);
  return [...raw]
    .sort((a, b) => b.laps.length - a.laps.length || lapsTotal(a.laps) - lapsTotal(b.laps))
    .map((d) => ({
      id: d.id,
      name: d.driverName,
      laps: sheetLapRows(d.laps),
      isViewer: viewerDriverId != null && d.id === viewerDriverId,
    }));
}

function toLibrarySession(s: LibraryApiSession): ImportedLibrarySession | null {
  const parsed = primaryLapRowsFromImportedPayload(s.parsedPayload);
  if (!parsed) return null;
  const whenIso = resolveImportedSessionDisplayTimeIso({
    sessionCompletedAt: s.sessionCompletedAt ?? null,
    parsedPayload: s.parsedPayload,
    createdAt: s.createdAt,
  });
  const timeOpts = {
    timingSource: timingSourceFromParserId(s.parserId) ?? timingSourceFromSourceUrl(s.sourceUrl),
    parserId: s.parserId,
    sourceUrl: s.sourceUrl,
    isWallClockTime: resolveImportedSessionHasWallClockTime({
      sessionCompletedAt: s.sessionCompletedAt ?? null,
      parsedPayload: s.parsedPayload,
    }),
  };
  const shown = importedSessionTimeForDisplay(whenIso, timeOpts);
  const practiceDriver = practiceDriverFromPayload(s.parsedPayload);
  const kind = importedSessionIsRaceResult(s.sourceUrl) ? "race" : "practice";
  const drivers = kind === "race" ? raceDrivers(s.parsedPayload, s.viewerDriverId ?? null) : [];
  return {
    id: s.id,
    selectLabel: formatDriverSessionLabel(parsed.driverName, whenIso, timeOpts),
    name: parsed.driverName?.trim() || "Imported session",
    laps: sheetLapRows(parsed.rows.map((r) => r.lapTimeSeconds)),
    sortTimeIso: whenIso,
    // A rival's practice is linked to no run, so its track is the one it was ticked at.
    trackName: s.trackName ?? practiceDriver.trackName,
    kind,
    trackClockIso: shown.timeZone === "UTC" ? shown.iso : null,
    practiceTransponder: practiceDriver.transponder,
    practiceSiteName: practiceDriver.siteName,
    onRunId: s.onRunId ?? null,
    mine: Boolean(s.mine),
    label: s.label?.trim() || null,
    sourceUrl: s.sourceUrl ?? null,
    drivers,
  };
}

/**
 * The viewer's imported timing sessions, in the shape the lap sheet takes — races under its
 * Race results tab, someone's practice under Practice.
 *
 * One copy, two hosts: the run pop-up and the full-page sheet both need this list and
 * were never going to keep two identical 40-line effects in step. Fetched rather than
 * server-rendered because the pop-up mounts long after its page did, and an import made
 * on the phone five minutes ago should be in the list either way.
 *
 * `reload` is for the Practice tab, which brings a session in and needs it on the sheet
 * straight away; one it can't find in the list is asked for by id.
 *
 * `trackName`: the sheet's track. The sheet compares within it only, so it asks for every
 * session there — not the newest 200 uploads, which left older races at that track unlisted.
 * With no track, the newest 200.
 */
export function useImportedLapLibrary(
  enabled = true,
  trackName: string | null = null
): {
  sessions: ImportedLibrarySession[];
  reload: (ensureId?: string) => Promise<void>;
  /** False until the first read comes back — an empty list then means "none", not "not yet". */
  loaded: boolean;
} {
  const [sessions, setSessions] = useState<ImportedLibrarySession[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** Asked for by id, outside the newest 200 — kept across reloads or they would drop off again. */
  const extras = useRef<Map<string, ImportedLibrarySession>>(new Map());
  const alive = useRef(true);

  const track = trackName?.trim() || null;
  const reload = useCallback(async (ensureId?: string) => {
    try {
      const res = await fetch(
        track ? `/api/lap-time-sessions?track=${encodeURIComponent(track)}` : "/api/lap-time-sessions",
        { cache: "no-store" }
      );
      const data = (await res.json().catch(() => null)) as { sessions?: LibraryApiSession[] } | null;
      if (!data?.sessions) return;
      const mapped: ImportedLibrarySession[] = [];
      for (const s of data.sessions) {
        const session = toLibrarySession(s);
        if (session) mapped.push(session);
      }
      if (ensureId && !mapped.some((m) => m.id === ensureId) && !extras.current.has(ensureId)) {
        const one = await fetch(`/api/lap-time-sessions/${encodeURIComponent(ensureId)}`, {
          cache: "no-store",
        });
        const body = (await one.json().catch(() => null)) as { session?: LibraryApiSession } | null;
        const session = body?.session ? toLibrarySession(body.session) : null;
        if (session) extras.current.set(session.id, session);
      }
      for (const extra of extras.current.values()) {
        if (!mapped.some((m) => m.id === extra.id)) mapped.push(extra);
      }
      if (alive.current) setSessions(mapped);
    } catch {
      // Keep what is on screen: a failed refresh must not empty a sheet someone is reading.
    } finally {
      if (alive.current) setLoaded(true);
    }
  }, [track]);

  useEffect(() => {
    alive.current = true;
    if (enabled) void reload();
    return () => {
      alive.current = false;
    };
  }, [enabled, reload]);

  return { sessions, reload, loaded };
}
