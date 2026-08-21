"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A value on a logged run that is a CHOICE, changed in place.
 *
 * ============================== WHY NOT A TEXT BOX ==============================
 *
 * `InlineValueEdit` is right for a number the driver measured — a ride height, a
 * temperature. It is wrong for everything that names a row in a table: a car, an
 * event, a tire set, an additive, a session type. Typing "Set 4 · run 6" into a text
 * field does not select set 4; it invents a string that matches nothing, and the run
 * quietly stops belonging to the rubber it was on.
 *
 * So anything that resolves to an id gets this instead. Same affordance from the
 * driver's side — tap the value, change it — and no way to name something that does
 * not exist.
 *
 * ============================== WHY A NATIVE SELECT ==============================
 *
 * Same call `InlineAdditiveEdit` made and for the same reason: a modal that takes over
 * the screen to offer a handful of rows is the worse control (see `SearchableSelect`).
 * The native picker is also the one control that is already correct on a phone, in a
 * webview, and for a screen reader, without this file owning any of that.
 *
 * ============================== WHY IT IS INERT UNTIL EDIT MODE ==============================
 *
 * `disabled` renders plain text with no underline and no hit target at all — not a
 * greyed-out control. A session view is a record you read; until the driver presses
 * Edit, nothing on it should look like it wants pressing (founder call, 2026-08-20).
 */

export type InlinePickOption = { id: string; label: string };

export function InlinePickEdit({
  value,
  valueId,
  options,
  loadOptions,
  ariaLabel,
  emptyLabel = "—",
  allowEmpty = false,
  disabled = false,
  align = "right",
  onSave,
  /**
   * Asked before anything is written, for a change that costs more than itself.
   * Resolving false abandons it and puts the old value back. The car uses this: moving
   * a run to another car takes its setup with it and changes what the diff compares
   * against, and the driver should be told that before it happens, not after.
   */
  confirm,
}: {
  /** What to show when closed. */
  value: string;
  /** The currently selected option, or null when nothing is set. */
  valueId: string | null;
  /** Ready-made options. Omit and pass `loadOptions` to fetch on first tap instead. */
  options?: InlinePickOption[];
  loadOptions?: () => Promise<InlinePickOption[]>;
  ariaLabel: string;
  emptyLabel?: string;
  allowEmpty?: boolean;
  disabled?: boolean;
  align?: "left" | "right";
  onSave: (nextId: string | null) => Promise<void>;
  confirm?: (next: InlinePickOption | null) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<InlinePickOption[] | null>(options ?? null);
  const [shown, setShown] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const selectRef = useRef<HTMLSelectElement | null>(null);

  // The parent re-renders with the server's answer after a save, and with the original
  // value after a rollback. Either way the display follows it.
  useEffect(() => setShown(value), [value]);
  useEffect(() => {
    if (options) setLoaded(options);
  }, [options]);

  // Leaving edit mode with the picker open would strand an open select over a
  // read-only record.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open || loaded || !loadOptions) return;
    let alive = true;
    void loadOptions()
      .then((next) => {
        if (alive) setLoaded(next);
      })
      .catch(() => {
        if (alive) setError("Couldn’t load the list");
      });
    return () => {
      alive = false;
    };
  }, [open, loaded, loadOptions]);

  useEffect(() => {
    if (open && loaded) selectRef.current?.focus();
  }, [open, loaded]);

  async function choose(rawNext: string) {
    const nextId = rawNext === "" ? null : rawNext;
    if (nextId === valueId) {
      setOpen(false);
      return;
    }
    const option = loaded?.find((o) => o.id === nextId) ?? null;
    setOpen(false);
    if (confirm && !(await confirm(option))) return;

    const previous = shown;
    setShown(option?.label ?? emptyLabel);
    setError(null);
    try {
      await onSave(nextId);
    } catch (err) {
      setShown(previous);
      setError(err instanceof Error ? err.message : "Could not save that");
    }
  }

  if (disabled) {
    return (
      <span className={cn("text-[13px]", shown.trim() === "" && "text-muted-foreground")}>
        {shown.trim() === "" ? emptyLabel : shown}
      </span>
    );
  }

  if (open) {
    return loaded ? (
      <select
        ref={selectRef}
        defaultValue={valueId ?? ""}
        onChange={(e) => void choose(e.target.value)}
        onBlur={() => setOpen(false)}
        aria-label={ariaLabel}
        className="max-w-[12rem] rounded-md border border-ring/60 bg-background px-1.5 py-0.5 text-[13px] text-foreground outline-none"
      >
        {allowEmpty ? <option value="">{emptyLabel}</option> : null}
        {loaded.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    ) : (
      <span className="text-[13px] text-muted-foreground">Loading…</span>
    );
  }

  const empty = shown.trim() === "" || shown === emptyLabel;

  return (
    <span className={cn("inline-flex flex-col gap-0.5", align === "right" ? "items-end" : "items-start")}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={`${ariaLabel}: ${empty ? "not set" : shown}. Tap to change.`}
        className={cn(
          "tap-active -mx-1 rounded-md px-1 text-[13px] transition-colors",
          align === "right" ? "text-right" : "text-left",
          // Always underlined while edit mode is on — a hover-only underline is
          // invisible on a phone, and a column of em-dashes then reads as "nothing
          // recorded" rather than "tap me".
          "underline decoration-dotted decoration-muted-foreground/45 underline-offset-4 hover:bg-muted/60 hover:decoration-foreground",
          empty ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {empty ? emptyLabel : shown}
      </button>
      {error ? (
        <span role="alert" className="text-[11px] leading-tight text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
