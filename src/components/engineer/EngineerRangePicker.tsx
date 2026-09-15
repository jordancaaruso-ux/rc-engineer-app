"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { chipToggleClass } from "@/components/ui/chipToggle";
import {
  EMPTY_RANGE_SCOPE,
  rangeScopeToQuery,
  type EngineerRangeScope,
} from "@/lib/engineer/rangeScope";

/**
 * The subject bar's filter picker (2026-09-14): which meeting, or which track, which car,
 * which dates. Same shape as the run picker beside it — a bordered box under the bar, chips
 * in rows — so the bar's two pickers read as one family. Choosing does nothing until "Use
 * this filter": the subject lives in the URL, and a half-picked filter must never be what the
 * next question is sent against.
 *
 * A meeting is the common case and the simplest: one chip, and it stands in for track +
 * dates. Picking one clears the track and date chips; picking a track or a date clears the
 * meeting. The count under the chips comes from the same route that lists the options, so
 * the driver sees "20 runs" before they ask, and "0 runs" is an answer, not a surprise.
 */
export type EngineerRangeOptions = {
  events: Array<{ id: string; name: string; trackName: string | null; from: string; to: string; runs: number }>;
  tracks: Array<{ id: string; name: string; runs: number }>;
  cars: Array<{ id: string; name: string; runs: number }>;
  first: string | null;
  last: string | null;
};

type Option = { id: string | null; label: string };

/** Calendar date `days` ago, in the reader's own zone — the Sessions filter's rule. */
function ymdDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function yearStart(): string {
  return `${new Date().getFullYear()}-01-01`;
}

const DATE_PRESETS: Array<{ id: string; label: string; from: () => string | null }> = [
  { id: "all", label: "All dates", from: () => null },
  { id: "30", label: "Last 30 days", from: () => ymdDaysAgo(30) },
  { id: "90", label: "Last 90 days", from: () => ymdDaysAgo(90) },
  { id: "year", label: "This year", from: () => yearStart() },
];

/** The picker lists the most recent meetings; older ones are reachable by track + dates. */
const MAX_EVENT_CHIPS = 8;

function ChipRow({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: Option[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border/70 px-2.5 py-2">
      <span className="mr-0.5 shrink-0 ui-title text-[9px] text-muted-foreground">{label}</span>
      {options.map((o) => (
        <button
          key={o.id ?? "all"}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={cn(chipToggleClass(value === o.id), "rounded-full px-2 py-0.5 text-[11px]")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EngineerRangePicker({
  options,
  loading,
  error,
  scope,
  disabled = false,
  onApply,
  onClose,
}: {
  options: EngineerRangeOptions | null;
  loading: boolean;
  error: string | null;
  /** The filter currently in the URL; null = none yet. */
  scope: EngineerRangeScope | null;
  disabled?: boolean;
  onApply: (scope: EngineerRangeScope) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<EngineerRangeScope>(scope ?? EMPTY_RANGE_SCOPE);
  const [count, setCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);

  // Live count for the draft, debounced a touch so a date being typed doesn't fire per key.
  const draftQuery = rangeScopeToQuery(draft);
  useEffect(() => {
    let cancelled = false;
    setCounting(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/engineer/range-options?count=1${draftQuery ? `&${draftQuery}` : ""}`);
        const data = (await res.json().catch(() => ({}))) as { count?: number | null };
        if (!cancelled) setCount(typeof data.count === "number" ? data.count : null);
      } catch {
        if (!cancelled) setCount(null);
      } finally {
        if (!cancelled) setCounting(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [draftQuery]);

  const eventOptions = useMemo<Option[]>(() => {
    const events = (options?.events ?? []).slice(0, MAX_EVENT_CHIPS);
    // Two "Clubday" meetings are two chips with one name; the date tells them apart.
    const nameCount = new Map<string, number>();
    for (const e of events) nameCount.set(e.name, (nameCount.get(e.name) ?? 0) + 1);
    return events.map((e) => ({
      id: e.id,
      label: `${e.name}${(nameCount.get(e.name) ?? 0) > 1 ? ` ${e.from.slice(5).replace("-", "/")}` : ""} · ${e.runs}`,
    }));
  }, [options]);
  const trackOptions = useMemo<Option[]>(
    () => [
      { id: null, label: "All tracks" },
      ...(options?.tracks ?? []).map((t) => ({ id: t.id, label: `${t.name} · ${t.runs}` })),
    ],
    [options]
  );
  const carOptions = useMemo<Option[]>(
    () => [{ id: null, label: "All cars" }, ...(options?.cars ?? []).map((c) => ({ id: c.id, label: c.name }))],
    [options]
  );

  const activePreset =
    draft.eventId == null && draft.to == null
      ? DATE_PRESETS.find((p) => p.from() === draft.from)?.id ?? null
      : null;

  return (
    <div className="rounded-lg border border-border bg-background/60" data-testid="engineer-range-picker">
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-2.5 py-2">
        <span className="text-sm text-foreground">Filter your runs</span>
        <button
          type="button"
          onClick={onClose}
          className="tap-active shrink-0 text-[11px] text-muted-foreground transition hover:text-foreground"
        >
          Close
        </button>
      </div>

      {loading ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">Loading your tracks…</p>
      ) : error ? (
        <p className="px-3 py-2 text-xs text-destructive">{error}</p>
      ) : (
        <>
          {eventOptions.length > 0 ? (
            <ChipRow
              label="Meeting"
              options={eventOptions}
              value={draft.eventId}
              disabled={disabled}
              onChange={(id) =>
                setDraft((d) =>
                  d.eventId === id ? { ...d, eventId: null } : { ...EMPTY_RANGE_SCOPE, carId: d.carId, eventId: id }
                )
              }
            />
          ) : null}
          <ChipRow
            label="Track"
            options={trackOptions}
            value={draft.eventId ? "__event" : draft.trackId}
            disabled={disabled}
            onChange={(id) => setDraft((d) => ({ ...d, eventId: null, trackId: id }))}
          />
          {carOptions.length > 2 ? (
            <ChipRow
              label="Car"
              options={carOptions}
              value={draft.carId}
              disabled={disabled}
              onChange={(id) => setDraft((d) => ({ ...d, carId: id }))}
            />
          ) : null}
          <ChipRow
            label="Dates"
            options={DATE_PRESETS.map((p) => ({ id: p.id, label: p.label }))}
            value={activePreset}
            disabled={disabled}
            onChange={(id) => {
              const preset = DATE_PRESETS.find((p) => p.id === id);
              setDraft((d) => ({ ...d, eventId: null, from: preset?.from() ?? null, to: null }));
            }}
          />
          <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-2.5 py-2">
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              From
              <input
                type="date"
                value={draft.from ?? ""}
                min={options?.first ?? undefined}
                max={options?.last ?? undefined}
                disabled={disabled}
                onChange={(e) => setDraft((d) => ({ ...d, eventId: null, from: e.target.value || null }))}
                aria-label="From date"
                className="h-7 rounded border border-border bg-background px-1.5 text-[12px] text-foreground ui-control outline-none"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              To
              <input
                type="date"
                value={draft.to ?? ""}
                min={options?.first ?? undefined}
                max={options?.last ?? undefined}
                disabled={disabled}
                onChange={(e) => setDraft((d) => ({ ...d, eventId: null, to: e.target.value || null }))}
                aria-label="To date"
                className="h-7 rounded border border-border bg-background px-1.5 text-[12px] text-foreground ui-control outline-none"
              />
            </label>
          </div>
          <div className="flex items-center justify-between gap-2 px-2.5 py-2">
            <span className="text-[11px] text-muted-foreground" aria-live="polite">
              {counting && count == null
                ? "Counting…"
                : count == null
                  ? ""
                  : `${count} run${count === 1 ? "" : "s"}`}
            </span>
            <Button
              type="button"
              variant="primary"
              disabled={disabled || count === 0}
              onClick={() => onApply(draft)}
              className="min-h-8 px-3 text-[12px]"
            >
              Use this filter
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
