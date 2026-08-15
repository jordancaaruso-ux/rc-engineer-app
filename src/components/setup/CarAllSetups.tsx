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
import { formatLap } from "@/lib/runLaps";
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

/**
 * Rows drawn before the "Show all" button.
 *
 * Since 2026-08-15 a run earns a row whenever its setup differs from the run before it, so a car
 * that gets fiddled with every session has a row for nearly every run — the list is long by design
 * now. It still opens short: a wall of 60 rows buries the sheets and saved setups underneath it.
 */
const HEAD_ROWS = 25;

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
  truncated,
}: {
  carId: string;
  entries: CarSetupHistoryEntry[];
  counts: CarSetupCounts;
  truncated: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; setupId: string; name: string } | null>(
    null
  );
  /** Optimistic saved-ness, so the bookmark fills on tap rather than after a round trip. */
  const [savedOverride, setSavedOverride] = useState<Record<string, boolean>>({});

  const isSaved = (e: CarSetupHistoryEntry) => savedOverride[e.id] ?? e.saved;

  const matching = useMemo(() => {
    if (filter === "all") return entries;
    if (filter === "saved") return entries.filter((e) => isSaved(e));
    return entries.filter((e) => e.kind === filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isSaved reads savedOverride below
  }, [entries, filter, savedOverride]);

  const shown = expanded ? matching : matching.slice(0, HEAD_ROWS);
  const hidden = matching.length - shown.length;

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

  /*
   * The heading, the hint and the chips live INSIDE the card.
   *
   * They used to float above it, which made this the only section on the car page whose title sat
   * on the page background while "Saved setups", "Tires", "Car" and "Delete" all wore theirs inside
   * their own card (founder, 2026-08-14). One list, one container: the chips filter what is in the
   * card, so they belong in it.
   */
  if (entries.length === 0) {
    return (
      <SurfaceCard variant="panel" contentClassName="text-sm text-muted-foreground">
        <Eyebrow>All setups</Eyebrow>
        Nothing yet. Log a run or upload a setup sheet and every setup this car has been on shows up
        here.
      </SurfaceCard>
    );
  }

  return (
    <div className="space-y-2">
      <SurfaceCard variant="panel" contentClassName="p-0">
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <Eyebrow className="mb-0">All setups</Eyebrow>
        <span className="ui-caption">Bookmark one to save it</span>
      </div>

      {chips.length > 1 ? (
        <div className="flex gap-1.5 overflow-x-auto px-4 pb-3.5 pt-3">
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
                  "text-[10px] tabular-nums",
                  filter === value ? "text-foreground/70" : "text-faint"
                )}
              >
                {count}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="pb-3.5" />
      )}

        {shown.length === 0 ? (
          <p className="ui-caption border-t border-border px-4 py-3">
            Nothing of that kind on this car yet.
          </p>
        ) : (
        <ul className="divide-y divide-border border-t border-border">
          {shown.map((entry) => {
            const saved = isSaved(entry);
            const busy = busyId === entry.id;
            const body = (
              <>
                {/*
                  Date over time. Five testing runs on one day at one track used to draw five
                  identical rows — same badge, same "Testing run", same track — so the only way to
                  tell them apart was to read the changed-value chips underneath. The clock time is
                  the cheapest fact that separates them, and it sits with the date because they
                  answer the same question.
                */}
                <span className="w-12 shrink-0 pt-0.5 text-right text-[11px] leading-tight tabular-nums text-muted-foreground">
                  {entry.dateLabel}
                  {entry.timeLabel ? (
                    /* A size down, and never wrapped: "12:45 PM" is eight glyphs and broke over two
                       lines at the date's size, which made every afternoon row a line taller than
                       the morning ones. The date is the fact you scan; the time only separates. */
                    <span className="block whitespace-nowrap text-[10px] text-faint">
                      {entry.timeLabel}
                    </span>
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 rounded border border-border px-1 py-px text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                      {KIND_BADGE[entry.kind]}
                    </span>
                    <span className="truncate text-sm text-foreground">{entry.title}</span>
                  </span>
                  <span className="ui-caption mt-0.5 block truncate tabular-nums">
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
                        <span className="rounded border border-border px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                          +{entry.changedLabels.length - MAX_CHIPS} more
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </span>

                {/*
                  Best lap, in a column of its own so the numbers stack at one x position and the
                  fastest run can be found by eye without re-sorting the list. The column is drawn
                  even when empty — a sheet has no lap time, and a ragged right edge would cost more
                  than the blank does. Empty rather than an em dash: a column of dashes reads as
                  data, and this is the absence of it.
                */}
                <span className="w-12 shrink-0 pt-0.5 text-right leading-tight">
                  {entry.bestLapSeconds != null ? (
                    <>
                      <span className="block text-sm tabular-nums text-foreground">
                        {formatLap(entry.bestLapSeconds)}
                      </span>
                      <span className="block text-[10px] uppercase tracking-[0.08em] text-faint">
                        best
                      </span>
                    </>
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
        )}

        {hidden > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="tap-active w-full border-t border-border px-4 py-3 text-xs font-medium text-primary-ink"
          >
            Show all {matching.length}
          </button>
        ) : null}
      </SurfaceCard>

      {error ? <p className="px-1 text-xs text-destructive">{error}</p> : null}

      {/*
        The footnote explains the WHOLE list, so it only speaks when the whole list is on screen.
        Under a chip it used to read "showing the 2 most recent" about a filter that was showing
        everything it had, and lecture about runs being left out while none were in view.
      */}
      {filter === "all" ? (
        <p className="ui-caption px-1">
          A run is listed when its setup differs from the run before it. Tires and additive don’t
          count as a setup change.
          {truncated ? " Only the last 60 runs were checked." : ""}
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
