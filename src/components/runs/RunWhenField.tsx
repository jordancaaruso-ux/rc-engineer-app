"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  RUN_AT_MIN_INPUT,
  runAtFromInput,
  runWhenLabel,
  toLocalDateTimeInput,
} from "@/lib/runs/logRunSession";

/**
 * When the car ran, for a run typed in by hand.
 *
 * A hand-logged run used to be stamped with the moment it was saved, so last night's practice
 * logged this morning landed on today: it missed that night's meeting and carried this
 * morning's weather, and the run page had no way to move it afterwards (test drive
 * 2026-09-26). A run brought in from a timing site already carries its real time; this is for
 * the rest. Never the future — a run can't have happened yet.
 */

const TEXT_BUTTON =
  "tap-active shrink-0 text-[13px] font-semibold text-primary-ink underline-offset-4 hover:underline disabled:opacity-50";

/**
 * Log run, Session step: one quiet line, "Today, 5:04 PM · Change". "Change" opens the phone's
 * own date-and-time picker. Untouched, the run is stamped when it is saved, as before; a run
 * logged into a meeting that is already over shows (and saves) that meeting's day instead.
 * Laps brought in from a timing site carry their own time, which wins, so the line says so.
 */
export function RunWhenField({
  value,
  fallback = null,
  fromTimingSheet = false,
  onChange,
}: {
  /** The time the driver picked; null until they pick one. */
  value: Date | null;
  /** Shown and saved while nothing is picked: a past meeting's day. Null means now. */
  fallback?: Date | null;
  /** The run's laps came off a timing sheet with its own time: nothing to pick. */
  fromTimingSheet?: boolean;
  /** Null goes back to the default. */
  onChange: (next: Date | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Read after mount (the server's clock and zone are not the phone's), then every half minute
  // so an untouched line doesn't go stale while the form sits open.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    try {
      el.showPicker();
    } catch {
      // Not every browser opens the picker from here; the field is there to tap.
    }
  }, [editing]);

  const shown = value ?? fallback;
  const current = shown ?? now ?? new Date();

  return (
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <span className="shrink-0 text-[13px] font-medium text-foreground">When</span>
      {fromTimingSheet ? (
        <span className="min-w-0 truncate text-[13px] text-muted-foreground">From the timing sheet</span>
      ) : editing ? (
        <span className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-2">
          <input
            ref={inputRef}
            type="datetime-local"
            aria-label="When the car ran"
            defaultValue={toLocalDateTimeInput(current)}
            min={RUN_AT_MIN_INPUT}
            max={toLocalDateTimeInput(now ?? new Date())}
            onChange={(e) => {
              // A half-typed or cleared field says nothing yet: the last good time stands.
              const next = runAtFromInput(e.target.value);
              if (next) onChange(next);
            }}
            className="form-control min-w-0 px-2 py-1.5 fig-stat"
          />
          {value && !fallback ? (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setEditing(false);
              }}
              className={TEXT_BUTTON}
            >
              Now
            </button>
          ) : null}
          <button type="button" onClick={() => setEditing(false)} className={TEXT_BUTTON}>
            Done
          </button>
        </span>
      ) : (
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="fig-stat truncate text-foreground">
            {now ? runWhenLabel(shown ?? now, now) : "Now"}
          </span>
          <span aria-hidden className="text-faint">
            ·
          </span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Change when the car ran"
            className={TEXT_BUTTON}
          >
            Change
          </button>
        </span>
      )}
    </div>
  );
}

/**
 * The run page's Date / time, in edit mode: tap the underlined time, pick another, Save.
 *
 * Save and Cancel are buttons rather than the commit-on-blur of `InlineValueEdit`: a phone's
 * date picker takes focus away from the field while it is open, and a blur there would save
 * (or drop) the old value before the new one is picked.
 */
export function RunWhenInlineEdit({
  label,
  valueIso,
  onSave,
}: {
  /** The time as the cell prints it. */
  label: string;
  /** The instant behind it. */
  valueIso: string;
  /** Resolve to keep, throw to say why not. */
  onSave: (iso: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function save() {
    const next = runAtFromInput(inputRef.current?.value ?? "");
    if (!next) {
      setError("Pick a date and time.");
      return;
    }
    setEditing(false);
    // Minute precision: the picker can't show seconds, so an untouched field is no change.
    if (Math.abs(next.getTime() - new Date(valueIso).getTime()) < 60_000) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(next.toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <input
          ref={inputRef}
          type="datetime-local"
          aria-label="Date / time"
          defaultValue={toLocalDateTimeInput(new Date(valueIso))}
          min={RUN_AT_MIN_INPUT}
          max={toLocalDateTimeInput(new Date())}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          className="form-control min-w-0 px-2 py-1 fig-stat"
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void save();
          }}
          className={TEXT_BUTTON}
        >
          Save
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setError(null);
            setEditing(false);
          }}
          className="tap-active shrink-0 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col gap-0.5">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setError(null);
          setEditing(true);
        }}
        disabled={saving}
        aria-label={`Date / time: ${label}. Tap to change.`}
        className={cn(
          "tap-active -mx-1 rounded-md px-1 fig-stat text-foreground transition-colors",
          // Always underlined, like every other correctable value here: a phone has no hover.
          "underline decoration-dotted decoration-muted-foreground/45 underline-offset-4 hover:bg-muted/60 hover:decoration-foreground",
          saving && "opacity-60"
        )}
      >
        {label}
      </button>
      {error ? (
        <span role="alert" className="text-[11px] leading-tight text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
