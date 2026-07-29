"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";

/**
 * Global baselines published against this car's chassis — kit, manufacturer base sheets, and pro
 * setups. Read-only here: the only action is taking one for yourself.
 *
 * "Save a copy" writes a normal saved setup on this car and opens it, so the values are yours to
 * edit from that moment. Nothing stays linked to the global row except a lineage id, which is why
 * an admin editing or deleting the baseline later can't touch what you saved.
 */

export type CarBaselineRow = {
  id: string;
  name: string;
  kindLabel: string;
  contextLabel: string | null;
  notes: string | null;
  valueCount: number;
};

export function CarBaselineSetupsCard({
  carId,
  baselines,
}: {
  carId: string;
  baselines: CarBaselineRow[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveCopy = async (row: CarBaselineRow) => {
    setBusyId(row.id);
    setError(null);
    try {
      const res = await fetch("/api/setup-snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carId, name: row.name, fromBaselineId: row.id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not save a copy.");
      }
      const body = (await res.json()) as { setup: { id: string } };
      router.push(`/cars/${carId}/setups/${body.setup.id}/edit`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save a copy.");
      setBusyId(null);
    }
  };

  return (
    <CardPanel contentClassName="space-y-3">
      <Eyebrow>Baseline setups</Eyebrow>
      <p className="text-xs text-muted-foreground">
        Published sheets for this chassis. Save one to your setups and it becomes yours to change.
      </p>

      <ul className="-mx-1">
        {baselines.map((b) => (
          <li
            key={b.id}
            className="flex items-start justify-between gap-3 border-b border-border/60 px-1 py-2.5 last:border-0"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {b.kindLabel}
                </span>
                <span className="truncate text-sm text-foreground">{b.name}</span>
              </div>
              <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {b.valueCount} values
                {b.contextLabel ? ` · ${b.contextLabel}` : ""}
              </div>
              {b.notes ? <p className="mt-1 text-xs text-muted-foreground">{b.notes}</p> : null}
            </div>
            <button
              type="button"
              className="shrink-0 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium transition hover:bg-muted disabled:opacity-50"
              onClick={() => void saveCopy(b)}
              disabled={busyId === b.id}
            >
              {busyId === b.id ? "Saving…" : "Save a copy"}
            </button>
          </li>
        ))}
      </ul>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </CardPanel>
  );
}
