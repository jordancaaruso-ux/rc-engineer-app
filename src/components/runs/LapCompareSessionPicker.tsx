"use client";

/**
 * The session picker for the lap-times sheet — the list of things you can put
 * beside the target, and the segments that carve it up.
 *
 * Lives in its own file because it is rendered twice from the same state: as a
 * bottom sheet on a phone, and inline in the desktop rail. Both call
 * `LapCompareSessionList` with identical props, so a row can never look or
 * behave differently depending on which surface asked for it.
 *
 * It is deliberately dumb — every row it draws was already chosen by the scope
 * and segment filters in `LapComparisonColumnGrid`. It decides nothing about
 * which sessions are comparable; it only draws them.
 */

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEnterExit } from "@/components/ui/Collapse";
import { formatLap } from "@/lib/runLaps";

export type LapPickerRow = {
  id: string;
  /** Session name — "Round 3 · A-main", a car, or a driver off the timing sheet. */
  name: string;
  /** Wall time, pre-formatted by the caller so this file owns no date policy. */
  when: string;
  bestLap: number | null;
};

export type LapPickerGroup = {
  key: string;
  /** Heading above the rows — "This test day · MR33 Arena". */
  label: string;
  rows: LapPickerRow[];
};

/** Which slice of the comparable sessions is on screen. */
export type LapPickerSegment = {
  key: string;
  label: string;
  count: number;
};

export function LapCompareSegmentBar({
  segments,
  active,
  onSelect,
}: {
  segments: LapPickerSegment[];
  active: string;
  onSelect: (key: string) => void;
}) {
  // One segment is not a choice — drawing a control that can only be pressed
  // into its current state reads as broken. A solo run has only its driver.
  if (segments.length < 2) return null;
  return (
    <div
      className="flex gap-0.5 rounded-md border border-border bg-surface-runna-inset p-0.5"
      role="tablist"
      aria-label="Whose sessions to compare against"
    >
      {segments.map((s) => {
        const on = s.key === active;
        return (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={on}
            // text-[10px]/px-1: in the 17rem desktop rail, three segments at 11px
            // clipped "Teammates" to "Teammat…".
            className={cn(
              "min-w-0 flex-1 truncate rounded px-1 py-1.5 text-[10px] transition",
              on
                ? "bg-primary font-semibold text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => onSelect(s.key)}
          >
            {s.label}
            <span className={cn("ml-1 tabular-nums", on ? "opacity-70" : "opacity-60")}>
              {s.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PickerRow({
  row,
  checked,
  onToggle,
}: {
  row: LapPickerRow;
  checked: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <li>
      <label
        className={cn(
          "flex cursor-pointer items-center gap-2.5 rounded-md border px-2 py-1.5 transition",
          checked
            ? "border-border bg-surface-runna-inset"
            : "border-border/60 bg-transparent hover:bg-surface-runna-inset/60"
        )}
      >
        <input
          type="checkbox"
          className="shrink-0 accent-primary"
          checked={checked}
          onChange={() => onToggle(row.id)}
        />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[12px] text-foreground">{row.name}</span>
          <span className="block truncate text-[10px] tabular-nums text-muted-foreground">
            {row.when}
          </span>
        </span>
        {/* Best lap earns the right-hand column: it is the one number that decides
            whether a session is worth ticking at all. */}
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatLap(row.bestLap)}
        </span>
      </label>
    </li>
  );
}

export function LapCompareSessionList({
  groups,
  selectedIds,
  onToggle,
  target,
  className,
}: {
  groups: LapPickerGroup[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  /** The row everything is measured against — pinned above the groups, never tickable. */
  target: LapPickerRow | null;
  className?: string;
}) {
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  return (
    <div className={cn("space-y-3", className)}>
      {target ? (
        <div className="flex items-center gap-2.5 rounded-md border border-primary/60 bg-primary/10 px-2 py-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[12px] text-foreground">{target.name}</span>
              <span className="ui-label-caps shrink-0 rounded-full border border-primary/50 px-1.5 text-[9px] uppercase text-primary">
                Target
              </span>
            </span>
            <span className="block truncate text-[10px] tabular-nums text-muted-foreground">
              {target.when}
            </span>
          </span>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-primary">
            {formatLap(target.bestLap)}
          </span>
        </div>
      ) : null}

      {total === 0 ? (
        <p className="px-0.5 py-3 text-[11px] text-muted-foreground">
          Nothing else to compare against here. Widen the scope to reach other tracks and
          events.
        </p>
      ) : (
        groups.map((g) => (
          <div key={g.key} className="space-y-1">
            <p className="ui-label-caps text-[9px] uppercase tracking-wider">{g.label}</p>
            <ul className="space-y-1">
              {g.rows.map((row) => (
                <PickerRow
                  key={row.id}
                  row={row}
                  checked={selectedIds.includes(row.id)}
                  onToggle={onToggle}
                />
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}

/**
 * The phone form of the picker: a bottom sheet over the lap-times modal.
 *
 * Same construction as `PickerSheet` — portalled to `<body>` so no transformed
 * ancestor can turn `fixed` into `absolute`, scroll-locked underneath, and the
 * list as the only scroller with `overscroll-contain`. It sits at z-[70] to
 * clear the lap modal's z-[60]; the modal is the thing it opens *from*.
 *
 * Unlike `PickerSheet` this is a multi-select, so there is no select-and-close:
 * ticking mutates the grid live behind the sheet, and the footer button is a
 * "done looking" dismissal rather than a commit.
 */
export function LapCompareSheet({
  open,
  onClose,
  selectedCount,
  children,
}: {
  open: boolean;
  onClose: () => void;
  selectedCount: number;
  children: ReactNode;
}) {
  const sheet = useEnterExit(open, 300);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!sheet.mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[70] flex items-end justify-center bg-black/50 transition-opacity duration-300 ease-out motion-reduce:transition-none sm:items-center",
        sheet.entered ? "opacity-100" : "opacity-0"
      )}
      role="dialog"
      aria-modal="true"
      aria-label="Choose sessions to compare"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          "flex h-[min(85dvh,40rem)] max-h-full w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-card/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-16px_40px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl transition-transform duration-300 ease-out motion-reduce:transition-none sm:rounded-2xl sm:pb-2",
          sheet.entered ? "translate-y-0" : "translate-y-full sm:translate-y-4"
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-3 sm:hidden">
          <div className="mx-auto h-1 w-9 rounded-full bg-white/15" aria-hidden />
        </div>
        <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-2.5">
          <h2 className="min-w-0 truncate text-[15px] font-bold tracking-tight text-foreground">
            Compare with
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="tap-active -mr-1 flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          >
            <X className="size-5" strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 pt-1">
          {children}
        </div>

        <div className="border-t border-white/10 px-3 pb-1 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="tap-active w-full rounded-md bg-primary px-3 py-2.5 text-[13px] font-semibold text-primary-foreground transition hover:opacity-90"
          >
            {selectedCount === 0
              ? "Done"
              : `Show ${selectedCount} comparison${selectedCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
