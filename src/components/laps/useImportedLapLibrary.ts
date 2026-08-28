"use client";

import { useEffect, useState } from "react";
import type { LapRow } from "@/lib/lapAnalysis";
import { primaryLapRowsFromImportedPayload } from "@/lib/lapImport/fromPayload";
import {
  formatDriverSessionLabel,
  resolveImportedSessionDisplayTimeIso,
  resolveImportedSessionHasWallClockTime,
  timingSourceFromParserId,
  timingSourceFromSourceUrl,
} from "@/lib/lapImport/labels";

export type ImportedLibrarySession = {
  id: string;
  selectLabel: string;
  name: string;
  laps: LapRow[];
  sortTimeIso: string;
  trackName: string | null;
};

/**
 * The viewer's imported timing sessions, in the shape the lap sheet's "My imports"
 * segment takes.
 *
 * One copy, two hosts: the run pop-up and the full-page sheet both need this list and
 * were never going to keep two identical 40-line effects in step. Fetched rather than
 * server-rendered because the pop-up mounts long after its page did, and an import made
 * on the phone five minutes ago should be in the list either way.
 */
export function useImportedLapLibrary(enabled = true): ImportedLibrarySession[] {
  const [sessions, setSessions] = useState<ImportedLibrarySession[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch("/api/lap-time-sessions", { cache: "no-store" })
      .then((r) => r.json().catch(() => null))
      .then(
        (data: {
          sessions?: Array<{
            id: string;
            createdAt: string;
            sessionCompletedAt?: string | null;
            sourceUrl?: string | null;
            parserId?: string | null;
            trackName?: string | null;
            parsedPayload: unknown;
          }>;
        } | null) => {
          if (!alive || !data?.sessions) return;
          const mapped: ImportedLibrarySession[] = [];
          for (const s of data.sessions) {
            const parsed = primaryLapRowsFromImportedPayload(s.parsedPayload);
            if (!parsed) continue;
            const whenIso = resolveImportedSessionDisplayTimeIso({
              sessionCompletedAt: s.sessionCompletedAt ?? null,
              parsedPayload: s.parsedPayload,
              createdAt: s.createdAt,
            });
            mapped.push({
              id: s.id,
              selectLabel: formatDriverSessionLabel(parsed.driverName, whenIso, {
                timingSource:
                  timingSourceFromParserId(s.parserId) ?? timingSourceFromSourceUrl(s.sourceUrl),
                isWallClockTime: resolveImportedSessionHasWallClockTime({
                  sessionCompletedAt: s.sessionCompletedAt ?? null,
                  parsedPayload: s.parsedPayload,
                }),
              }),
              name: parsed.driverName?.trim() || "Imported session",
              laps: parsed.rows,
              sortTimeIso: whenIso,
              trackName: s.trackName ?? null,
            });
          }
          setSessions(mapped);
        }
      )
      .catch(() => {
        if (alive) setSessions([]);
      });
    return () => {
      alive = false;
    };
  }, [enabled]);

  return sessions;
}
