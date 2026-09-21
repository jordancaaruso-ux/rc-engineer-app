"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LapRow } from "@/lib/lapAnalysis";
import { primaryLapRowsFromImportedPayload } from "@/lib/lapImport/fromPayload";
import {
  formatDriverSessionLabel,
  importedSessionTimeForDisplay,
  resolveImportedSessionDisplayTimeIso,
  resolveImportedSessionHasWallClockTime,
  timingSourceFromParserId,
  timingSourceFromSourceUrl,
} from "@/lib/lapImport/labels";
import { importedSessionIsPractice } from "@/lib/practiceField/practiceField";

export type ImportedLibrarySession = {
  id: string;
  selectLabel: string;
  name: string;
  laps: LapRow[];
  sortTimeIso: string;
  trackName: string | null;
  /** Someone's practice, or a race result — which tab of the lap sheet it is filed under. */
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
  parsedPayload: unknown;
};

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
  return {
    id: s.id,
    selectLabel: formatDriverSessionLabel(parsed.driverName, whenIso, timeOpts),
    name: parsed.driverName?.trim() || "Imported session",
    laps: parsed.rows,
    sortTimeIso: whenIso,
    // A rival's practice is linked to no run, so its track is the one it was ticked at.
    trackName: s.trackName ?? practiceDriver.trackName,
    kind: importedSessionIsPractice(s.sourceUrl) ? "practice" : "race",
    trackClockIso: shown.timeZone === "UTC" ? shown.iso : null,
    practiceTransponder: practiceDriver.transponder,
    practiceSiteName: practiceDriver.siteName,
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
 * straight away. The list endpoint returns the newest 200 only, so a session brought in long ago
 * and ticked again today is asked for by id when the list doesn't hold it.
 */
export function useImportedLapLibrary(enabled = true): {
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

  const reload = useCallback(async (ensureId?: string) => {
    try {
      const res = await fetch("/api/lap-time-sessions", { cache: "no-store" });
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
  }, []);

  useEffect(() => {
    alive.current = true;
    if (enabled) void reload();
    return () => {
      alive.current = false;
    };
  }, [enabled, reload]);

  return { sessions, reload, loaded };
}
