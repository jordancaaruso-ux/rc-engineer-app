"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bookmark, ChevronRight, Loader2 } from "lucide-react";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { Eyebrow } from "@/components/ui/panel";
import { ActionToast } from "@/components/ui/ActionToast";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { keepSetup, renameSetup } from "@/lib/setup/keepSetupClient";
import type { CarSetupCounts, CarSetupHistoryEntry } from "@/lib/setup/carSetupHistory";

/**
 * "All setups" — every setup this car can offer, in one date-ordered list.
 *
 * ============================== THE TWO MARKS ==============================
 *
 * A row carries two independent facts, so it carries two independent marks:
 *
 *  - the BADGE says where the setup came from (Run / Sheet / Baseline / Saved), and never changes;
 *  - the BOOKMARK says whether the driver kept it, and toggles.
 *
 * Collapsing them into one tag was the first thing tried and it reads wrong immediately: a saved
 * run is still a run, and a chip saying "Saved" would lose the only thing that tells you the setup
 * was ever on the track. Keeping them apart is also what lets the Runs chip and the Saved chip both
 * count the same row without either one lying.
 *
 * ============================== WHY THE CHIPS CARRY COUNTS ==============================
 *
 * A bare row of chips is decoration — you cannot tell which are worth pressing. The count is the
 * one true thing each chip knows, and it turns the row into a summary of the car: 47 runs, 3
 * sheets, 2 baselines. A chip with nothing behind it is not rendered, so a young car shows one
 * chip, not five greyed ones.
 *
 * ============================== SAVING ==============================
 *
 * One tap, no question asked: the setup keeps the name the row is already showing. The rename is
 * offered in the toast afterwards and is meant to be ignored (founder call 2026-08-11 — the old
 * flow made every save pay for a prompt).
 *
 * Saving MARKS rather than copies, so the row stays exactly where it is and its bookmark fills.
 * Baselines are the exception the data forces: they are global rows, not this driver's, so there
 * is nothing to mark and "Save a copy" writes a new setup instead.
 */

type Filter = "all" | "run" | "sheet" | "baseline" | "saved";

const MAX_CHIPS = 4;

const KIND_BADGE: Record<CarSetupHistoryEntry["kind"], string> = {
  run: "Run",
  sheet: "Sheet",
  baseline: "Baseline",
  saved: "Saved",
};

export function CarAllSetups({
  carId,
  entries,
  counts,
  hasMore,
  truncated,
}: {
  carId: string;
  entries: CarSetupHistoryEntry[];
  counts: CarSetupCounts;
  hasMore: boolean;
  truncated: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filter, setFilter] = useState<Filter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; setupId: string; name: string } | null>(
    null
  );
  /** Optimistic saved-ness, so the bookmark fills on tap rather than after a round trip. */
  const [savedOverride, setSavedOverride] = useState<Record<string, boolean>>({});

  const isSaved = (e: CarSetupHistoryEntry) => savedOverride[e.id] ?? e.saved;

  const shown = useMemo(() => {
    if (filter === "all") return entries;
    if (filter === "saved") return entries.filter((e) => isSaved(e));
    return entries.filter((e) => e.kind === filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isSaved reads savedOverride below
  }, [entries, filter, savedOverride]);

  const chips = useMemo(() => {
    const live = { ...counts, saved: entries.filter((e) => isSaved(e)).length };
    return (
      [
        ["all", "All", live.all],
        ["run", "Runs", live.run],
        ["sheet", "Sheets", live.sheet],
        ["baseline", "Baselines", live.baseline],
        ["saved", "Saved", live.saved],
      ] as Array<[Filter, string, number]>
    ).filter(([value, , count]) => value === "all" || count > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- same
  }, [counts, entries, savedOverride]);

  /** One tap: keep it under the name it already has. The rename comes after, in the toast. */
  const toggleSaved = async (entry: CarSetupHistoryEntry) => {
    const next = !isSaved(entry);
    setBusyId(entry.id);
    setError(null);
    haptic("light");
    try {
      await keepSetup({ setupId: entry.id, saved: next, name: entry.title });
      setSavedOverride((prev) => ({ ...prev, [entry.id]: next }));
      setToast(
        next
          ? { message: `Saved “${entry.title}”.`, setupId: entry.id, name: entry.title }
          : null
      );
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this setup.");
    } finally {
      setBusyId(null);
    }
  };

  /** Baselines are global rows — taking one writes a setup that is yours from that moment. */
  const saveCopy = async (entry: CarSetupHistoryEntry) => {
    if (!entry.baselineId) return;
    setBusyId(entry.id);
    setError(null);
    haptic("light");
    try {
      const res = await fetch("/api/setup-snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carId, name: entry.title, fromBaselineId: entry.baselineId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not save a copy.");
      }
      const body = (await res.json()) as { setup: { id: string } };
      setToast({
        message: `Saved a copy of “${entry.title}”.`,
        setupId: body.setup.id,
        name: entry.title,
      });
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save a copy.");
    } finally {
      setBusyId(null);
    }
  };

  const rename = async (setupId: string, currentName: string) => {
    const entered = window.prompt("Setup name", currentName);
    if (entered == null) return;
    const name = entered.trim();
    if (!name || name === currentName) return;
    try {
      await renameSetup(setupId, name);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename this setup.");
    }
  };

  if (entries.length === 0) {
    return (
      <div className="space-y-2">
        <div className="px-1">
          <Eyebrow>All setups</Eyebrow>
        </div>
        <SurfaceCard variant="panel" contentClassName="text-sm text-muted-foreground">
          Nothing yet. Log a run or upload a setup sheet and every setup this car has been on shows
          up here.
        </SurfaceCard>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <Eyebrow>All setups</Eyebrow>
        <span className="ui-caption">Bookmark one to save it</span>
      </div>

      {chips.length > 1 ? (
        <div className="flex gap-1.5 overflow-x-auto px-0.5 pb-0.5">
          {chips.map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              className={cn(
                "tap-active flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition",
                filter === value
                  ? "border-primary-ink/50 bg-accent/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
              <span
                className={cn(
                  "font-mono text-[10px] tabular-nums",
                  filter === value ? "text-foreground/70" : "text-faint"
                )}
              >
                {count}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <SurfaceCard variant="panel" contentClassName="p-0">
        <ul className="divide-y divide-border">
          {shown.map((entry) => {
            const saved = isSaved(entry);
            const busy = busyId === entry.id;
            const body = (
              <>
                <span className="w-11 shrink-0 pt-0.5 text-right font-mono text-[11px] leading-tight tabular-nums text-muted-foreground">
                  {entry.dateLabel}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 rounded border border-border px-1 py-px text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                      {KIND_BADGE[entry.kind]}
                    </span>
                    <span className="truncate text-sm text-foreground">{entry.title}</span>
                  </span>
                  <span className="ui-caption mt-0.5 block truncate font-mono tabular-nums">
                    {entry.meta}
                  </span>
                  {entry.notes ? (
                    <span className="mt-1 block text-xs text-muted-foreground">{entry.notes}</span>
                  ) : null}
                  {entry.changedLabels.length > 0 ? (
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      {entry.changedLabels.slice(0, MAX_CHIPS).map((label) => (
                        <span
                          key={label}
                          className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-foreground"
                        >
                          {label}
                        </span>
                      ))}
                      {entry.changedLabels.length > MAX_CHIPS ? (
                        <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                          +{entry.changedLabels.length - MAX_CHIPS} more
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </span>
              </>
            );

            return (
              <li key={`${entry.kind}-${entry.id}`} className="flex items-start">
                {/*
                  The row navigates; the bookmark does not. They are siblings rather than nested,
                  because a button inside a link is a click target inside a click target — the
                  bookmark would open the setup on every second tap on a phone.
                */}
                {entry.href ? (
                  <Link
                    href={entry.href}
                    prefetch={false}
                    className="tap-active group flex min-w-0 flex-1 items-start gap-3 py-3 pl-4 pr-2 transition hover:bg-muted/50"
                  >
                    {body}
                    <ChevronRight
                      className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                      aria-hidden
                    />
                  </Link>
                ) : (
                  <div className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-4 pr-2">{body}</div>
                )}

                {/*
                  Pinned to the title line, not centred in the row: a row with four changed-value
                  chips is three times as tall as one without, and a centred bookmark drifts down
                  the list at a different rate to the chevron beside it. `pt-1.5` puts its centre on
                  the chevron's.
                */}
                <div className="flex shrink-0 items-start pr-2 pt-1.5">
                  {entry.saveAction === "copy" ? (
                    <button
                      type="button"
                      onClick={() => void saveCopy(entry)}
                      disabled={busy}
                      className="tap-active rounded-md border border-border bg-card px-2.5 py-1.5 text-[11px] font-medium transition hover:bg-muted disabled:opacity-50"
                    >
                      {busy ? "Saving…" : "Save a copy"}
                    </button>
                  ) : entry.saveAction === "mark" ? (
                    <button
                      type="button"
                      onClick={() => void toggleSaved(entry)}
                      disabled={busy}
                      aria-pressed={saved}
                      aria-label={saved ? `Remove ${entry.title} from your setups` : `Save ${entry.title} to your setups`}
                      className={cn(
                        "tap-active grid size-9 place-items-center rounded-md transition disabled:opacity-50",
                        saved
                          ? "text-primary-ink hover:bg-primary/10"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      {busy ? (
                        <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
                      ) : (
                        <Bookmark
                          className="size-4"
                          strokeWidth={2}
                          fill={saved ? "currentColor" : "none"}
                          aria-hidden
                        />
                      )}
                    </button>
                  ) : (
                    /* Nothing was read off this sheet, so there is no setup to keep. */
                    <span className="grid size-9 place-items-center" aria-hidden />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </SurfaceCard>

      {shown.length === 0 ? (
        <p className="ui-caption px-1">Nothing of that kind on this car yet.</p>
      ) : null}

      {error ? <p className="px-1 text-xs text-destructive">{error}</p> : null}

      {/*
        The footnote explains the WHOLE list, so it only speaks when the whole list is on screen.
        Under a chip it used to read "showing the 2 most recent" about a filter that was showing
        everything it had, and lecture about runs being left out while none were in view.
      */}
      {filter === "all" ? (
        <p className="ui-caption px-1">
          {hasMore || truncated
            ? `Showing the ${shown.length} most recent${
                truncated ? " of the last 200 runs considered" : ""
              }. `
            : ""}
          Runs that changed nothing, or only tires and additive, are left out.
        </p>
      ) : null}

      <ActionToast
        message={toast?.message ?? null}
        action={
          toast ? { label: "Rename", onClick: () => void rename(toast.setupId, toast.name) } : null
        }
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}
