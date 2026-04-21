"use client";

import { useMemo } from "react";
import {
  computeFieldImportSessionFromSets,
  type FieldImportSession,
} from "@/lib/lapField/fieldImportSession";

function fmtSec(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(3);
}

type SetShape = {
  driverName: string;
  displayName: string | null;
  isPrimaryUser: boolean;
  laps: Array<{ lapNumber: number; lapTimeSeconds: number; isIncluded: boolean }>;
};

export function ImportedFieldSessionCard({ importedLapSets }: { importedLapSets: SetShape[] | undefined }) {
  const field: FieldImportSession | null = useMemo(
    () => computeFieldImportSessionFromSets(importedLapSets ?? []) ?? null,
    [importedLapSets]
  );

  if (!field) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-2">
      <div className="ui-title text-sm text-muted-foreground">Imported session — field</div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Same timing import, multiple drivers. Rank and gap use each driver&apos;s best included lap vs the session
        best. Fade is mean(second half) − mean(first half) of included laps (needs ≥4 laps); positive means slower
        toward the end of the stint.
      </p>
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">Driver</th>
              <th className="px-2 py-1.5 font-medium">Rank</th>
              <th className="px-2 py-1.5 font-medium">Best</th>
              <th className="px-2 py-1.5 font-medium">Gap to P1</th>
              <th className="px-2 py-1.5 font-medium">Fade</th>
            </tr>
          </thead>
          <tbody>
            {field.ranked.map((row, i) => (
              <tr
                key={`${row.label}-${i}`}
                className={row.isPrimaryUser ? "bg-primary/5" : undefined}
              >
                <td className="px-2 py-1.5">
                  {row.label}
                  {row.isPrimaryUser ? (
                    <span className="ml-1 text-[10px] text-muted-foreground">(your row)</span>
                  ) : null}
                </td>
                <td className="px-2 py-1.5 tabular-nums">{row.rank}</td>
                <td className="px-2 py-1.5 tabular-nums">{fmtSec(row.bestLapSeconds)}</td>
                <td className="px-2 py-1.5 tabular-nums">
                  {row.gapToSessionBestSeconds == null ? "—" : row.gapToSessionBestSeconds.toFixed(3)}
                </td>
                <td className="px-2 py-1.5 tabular-nums">{fmtSec(row.fadeSeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
