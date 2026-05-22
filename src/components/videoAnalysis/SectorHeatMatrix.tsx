"use client";

import type { SectorFastestRow } from "@/lib/videoAnalysis/sectorStats";

export function SectorHeatMatrix({ rows }: { rows: SectorFastestRow[] }) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">No sector lines configured (add s1, s2, … besides sf).</p>;
  }

  const trackIds = new Set<number>();
  for (const r of rows) {
    for (const t of r.byTrack) trackIds.add(t.motTrackId);
  }
  const ids = [...trackIds].sort((a, b) => a - b);

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="p-2 text-left">Sector</th>
            {ids.map((id) => (
              <th key={id} className="p-2 text-right font-mono">
                Car {id}
              </th>
            ))}
            <th className="p-2 text-right">Fastest</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.sectorId} className="border-b border-border/60">
              <td className="p-2 font-medium">{row.sectorLabel}</td>
              {ids.map((id) => {
                const cell = row.byTrack.find((t) => t.motTrackId === id);
                const isFast = cell?.motTrackId === row.fastestMotTrackId;
                return (
                  <td
                    key={id}
                    className={`p-2 text-right font-mono tabular-nums ${isFast ? "text-green-400 font-semibold" : ""}`}
                  >
                    {cell?.bestSec != null ? cell.bestSec.toFixed(3) : "—"}
                  </td>
                );
              })}
              <td className="p-2 text-right font-mono text-green-400">
                Car {row.fastestMotTrackId} · {row.fastestSec.toFixed(3)}s
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
