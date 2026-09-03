"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  distinctCandidateCars,
  filterCandidates,
  type RunCandidate,
} from "@/lib/engineer/runCandidates";

/**
 * The subject bar's run picker: one recent-first list of the driver's runs, with search and (on
 * multi-car accounts) a quick car filter. Tapping a row pins it. Runs only — see
 * runCandidates.ts for why the setup / event rows and the compare button did not come back.
 */
export function EngineerRunPicker({
  candidates,
  loading,
  error,
  pinnedRunId,
  disabled = false,
  onPick,
  onClose,
}: {
  candidates: RunCandidate[];
  loading: boolean;
  error: string | null;
  pinnedRunId: string | null;
  disabled?: boolean;
  onPick: (candidate: RunCandidate) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [carFilter, setCarFilter] = useState<string | null>(null);

  const cars = useMemo(() => distinctCandidateCars(candidates), [candidates]);
  const visible = useMemo(() => {
    const searched = filterCandidates(candidates, query);
    return carFilter ? searched.filter((c) => c.carId === carFilter) : searched;
  }, [candidates, query, carFilter]);

  return (
    <div className="rounded-lg border border-border bg-background/60">
      <div className="flex items-center gap-2 border-b border-border/70 px-2.5 py-2">
        <Search className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          placeholder="Search runs…"
          aria-label="Search runs"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          autoFocus
        />
        <button
          type="button"
          onClick={onClose}
          className="tap-active shrink-0 text-[11px] text-muted-foreground transition hover:text-foreground"
        >
          Close
        </button>
      </div>

      {cars.length >= 2 ? (
        <div className="flex flex-wrap gap-1.5 border-b border-border/70 px-2.5 py-2">
          {[{ carId: null as string | null, carName: "All cars" }, ...cars].map((car) => (
            <button
              key={car.carId ?? "all"}
              type="button"
              onClick={() => setCarFilter(car.carId)}
              className={cn(
                "tap-active rounded-full border px-2 py-0.5 text-[11px] transition",
                carFilter === car.carId
                  ? "border-primary-ink/60 bg-primary/10 text-foreground"
                  : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
              )}
            >
              {car.carName}
            </button>
          ))}
        </div>
      ) : null}

      <div className="max-h-56 overflow-y-auto py-1">
        {loading ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">Loading recent runs…</p>
        ) : error ? (
          <p className="px-3 py-2 text-xs text-destructive">{error}</p>
        ) : visible.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {candidates.length === 0 ? "Nothing to pin yet — log a run first." : "No matches."}
          </p>
        ) : (
          visible.map((c) => {
            const isPinned = c.id === pinnedRunId;
            return (
              <div key={c.id} className="flex items-stretch gap-1 px-1.5">
                <button
                  type="button"
                  disabled={disabled || isPinned}
                  onClick={() => onPick(c)}
                  className={cn(
                    "tap-active min-w-0 flex-1 rounded-md px-2 py-1.5 text-left transition",
                    isPinned ? "bg-primary/10" : "hover:bg-muted/50"
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 truncate text-sm text-foreground">{c.label}</span>
                    {isPinned ? (
                      <span className="shrink-0 text-[10px] text-muted-foreground">pinned</span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {[c.carName, c.sublabel].filter(Boolean).join(" — ") || "—"}
                  </span>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
