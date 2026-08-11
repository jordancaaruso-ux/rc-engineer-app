"use client";

import { useMemo, useState } from "react";
import { GitCompareArrows, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  distinctCandidateCars,
  filterCandidates,
  type AnchorCandidate,
} from "@/lib/engineerPhase5/anchorCandidates";

const KIND_BADGES: Record<AnchorCandidate["kind"], string> = {
  run: "Run",
  setup: "Setup",
  event: "Event",
};

/**
 * Attach picker for the Engineer's focus chip: one recent-first list across every
 * anchorable kind, with search and (on multi-car accounts) a quick car filter.
 * Tapping a row pins it; with a run already pinned, the compare button on another
 * run builds the pinned pair.
 */
export function EngineerAnchorPicker({
  candidates,
  loading,
  error,
  pinnedPrimaryRunId,
  disabled = false,
  onPickPrimary,
  onPickCompare,
  onPickSetupCombo,
  onClose,
}: {
  candidates: AnchorCandidate[];
  loading: boolean;
  error: string | null;
  /** When a run is pinned, other runs offer "compare against it" and setups offer "test vs it". */
  pinnedPrimaryRunId: string | null;
  disabled?: boolean;
  onPickPrimary: (candidate: AnchorCandidate) => void;
  onPickCompare: (candidate: AnchorCandidate) => void;
  onPickSetupCombo: (candidate: AnchorCandidate) => void;
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
          aria-label="Search anchor candidates"
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
            {candidates.length === 0 ? "Nothing to anchor yet — log a run first." : "No matches."}
          </p>
        ) : (
          visible.map((c) => {
            const isPinnedPrimary = c.kind === "run" && c.id === pinnedPrimaryRunId;
            const canCompare =
              c.kind === "run" && Boolean(pinnedPrimaryRunId) && !isPinnedPrimary;
            const canSetupCombo = c.kind === "setup" && Boolean(pinnedPrimaryRunId);
            return (
              <div key={`${c.kind}:${c.id}`} className="flex items-stretch gap-1 px-1.5">
                <button
                  type="button"
                  disabled={disabled || isPinnedPrimary}
                  onClick={() => onPickPrimary(c)}
                  className={cn(
                    "tap-active min-w-0 flex-1 rounded-md px-2 py-1.5 text-left transition",
                    isPinnedPrimary ? "bg-primary/10" : "hover:bg-muted/50"
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="shrink-0 rounded border border-border/70 bg-muted/40 px-1 py-px text-[9px] ui-title text-muted-foreground">
                      {KIND_BADGES[c.kind]}
                    </span>
                    <span className="min-w-0 truncate text-sm text-foreground">{c.label}</span>
                    {isPinnedPrimary ? (
                      <span className="shrink-0 text-[10px] text-muted-foreground">pinned</span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {[c.carName, c.sublabel].filter(Boolean).join(" — ") || "—"}
                  </span>
                </button>
                {canCompare ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onPickCompare(c)}
                    aria-label={`Compare ${c.label} against the pinned run`}
                    title="Compare against the pinned run"
                    className="tap-active my-0.5 shrink-0 rounded-md border border-border px-1.5 text-muted-foreground transition hover:border-primary-ink/60 hover:text-foreground"
                  >
                    <GitCompareArrows className="size-3.5" strokeWidth={2} aria-hidden />
                  </button>
                ) : canSetupCombo ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onPickSetupCombo(c)}
                    aria-label={`Test ${c.label} against the pinned run`}
                    title="Test this saved setup against the pinned run"
                    className="tap-active my-0.5 shrink-0 rounded-md border border-border px-1.5 text-[10px] font-semibold text-muted-foreground transition hover:border-primary-ink/60 hover:text-foreground"
                  >
                    vs run
                  </button>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
