"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Tap a value, retype it, done.
 *
 * ============================== WHY THIS EXISTS ==============================
 *
 * Fixing a mistyped track temp on a logged run used to mean the pencil in the
 * corner, which opens the six-step log-run wizard at `/runs/[id]/edit`, which
 * saves by navigating to the dashboard. Nine taps and a lost scroll position to
 * change two digits, on the surface where the driver had already spotted the
 * mistake (founder call, 2026-08-20). Corrections happen constantly — a run is
 * logged at the track between heats, and the tidying happens later.
 *
 * So the value on the page IS the control. No route change, no form, no save
 * button: commit on Enter or on blur, abandon on Escape.
 *
 * ============================== WHY IT COMMITS OPTIMISTICALLY ==============================
 *
 * The typed value shows immediately and the request goes out behind it. On a
 * phone at a track the connection is whatever the venue has, and a control that
 * greys out for two seconds per digit is one nobody uses twice. A failure rolls
 * the value back and says so — visibly, next to the field, not in a toast that
 * has already gone.
 */

export type InlineValueEditProps = {
  /** For the accessible name — "Track temp", not "34". */
  label: string;
  /** What is currently stored. The component mirrors it; the parent owns it. */
  value: string;
  /** Rendered after the value, and never part of the editable text. */
  unit?: string | null;
  /** Shown when there is no value — tappable, so an empty field can be filled. */
  placeholder?: string;
  /** Reject before saving; return a message to show, or null to accept. */
  validate?: (next: string) => string | null;
  /** Resolve to commit, throw to roll back. Not called when nothing changed. */
  onSave: (next: string) => Promise<void>;
  disabled?: boolean;
  className?: string;
  /** Digits get a numeric keypad on a phone. */
  numeric?: boolean;
};

export function InlineValueEdit({
  label,
  value,
  unit,
  placeholder = "—",
  validate,
  onSave,
  disabled = false,
  className,
  numeric = false,
}: InlineValueEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // A blur that happens because we are closing the editor ourselves must not
  // commit a second time — Enter blurs the input on its way out.
  const committedRef = useRef(false);

  // The parent re-renders with the server's answer after a save, and with the
  // original value after a rollback. Either way the display follows it.
  useEffect(() => {
    setShown(value);
  }, [value]);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  function open() {
    if (disabled || saving) return;
    committedRef.current = false;
    setError(null);
    setDraft(shown);
    setEditing(true);
  }

  function cancel() {
    committedRef.current = true;
    setEditing(false);
    setDraft(shown);
  }

  async function commit() {
    if (committedRef.current) return;
    committedRef.current = true;
    const next = draft.trim();
    setEditing(false);

    if (next === shown.trim()) return;

    const message = validate?.(next) ?? null;
    if (message) {
      setError(message);
      return;
    }

    const rollback = shown;
    setShown(next);
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
    } catch (err) {
      setShown(rollback);
      setError(err instanceof Error ? err.message : "Could not save that");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <span className={cn("inline-flex items-baseline gap-1", className)}>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={() => void commit()}
          type="text"
          inputMode={numeric ? "decimal" : "text"}
          enterKeyHint="done"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label={label}
          className={cn(
            "w-[6.5rem] min-w-0 rounded-md border border-ring/60 bg-background px-1.5 py-0.5",
            "text-right text-[13px] tabular-nums text-foreground outline-none"
          )}
        />
        {unit ? <span className="shrink-0 text-[11px] text-muted-foreground">{unit}</span> : null}
      </span>
    );
  }

  const empty = shown.trim() === "" || shown === "—";

  return (
    <span className={cn("inline-flex flex-col items-end gap-0.5", className)}>
      <span className="inline-flex items-baseline gap-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            open();
          }}
          disabled={disabled}
          aria-label={`${label}: ${empty ? "not set" : shown}. Tap to edit.`}
          className={cn(
            "tap-active -mx-1 rounded-md px-1 text-right text-[13px] tabular-nums transition-colors",
            /*
             * The dotted underline is ALWAYS on, not just on hover. A phone has no
             * hover, and a hover-only affordance on a column of em-dashes reads as
             * a run with nothing recorded rather than as a row waiting to be filled
             * in — which is exactly the case a driver most needs to see (measured on
             * a real run at 390px, 2026-08-20).
             */
            !disabled &&
              "underline decoration-dotted decoration-muted-foreground/45 underline-offset-4 hover:bg-muted/60 hover:decoration-foreground",
            disabled && "cursor-default",
            empty ? "text-muted-foreground" : "text-foreground",
            saving && "opacity-60"
          )}
        >
          {empty ? placeholder : shown}
        </button>
        {unit && !empty ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">{unit}</span>
        ) : null}
      </span>
      {error ? (
        <span role="alert" className="text-[11px] leading-tight text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
