"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The additive on a logged run, changed in place.
 *
 * A native `<select>`, not the searchable sheet: the additive catalog is a short
 * list, and the app's rule is that a modal which takes over the screen to offer a
 * handful of things is the worse control (see `SearchableSelect`). The catalog is
 * fetched on the first tap rather than on mount — this panel renders inside every
 * expanded Sessions row, and a run nobody is correcting should cost no request.
 */

type AdditiveOption = { id: string; displayName: string };

export function InlineAdditiveEdit({
  value,
  valueId,
  onSave,
}: {
  /** What to show when closed. */
  value: string;
  /** Currently selected catalog row, or null. */
  valueId: string | null;
  onSave: (additiveTypeId: string | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<AdditiveOption[] | null>(null);
  const [shown, setShown] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const selectRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    setShown(value);
  }, [value]);

  useEffect(() => {
    if (!open || options) return;
    let alive = true;
    void fetch("/api/additive-types")
      .then((res) => res.json())
      .then((payload: { additiveTypes?: AdditiveOption[] }) => {
        if (!alive) return;
        setOptions(payload.additiveTypes ?? []);
      })
      .catch(() => {
        if (alive) setError("Couldn’t load the additive list");
      });
    return () => {
      alive = false;
    };
  }, [open, options]);

  useEffect(() => {
    if (open && options) selectRef.current?.focus();
  }, [open, options]);

  async function choose(next: string) {
    const id = next === "" ? null : next;
    const previous = shown;
    setOpen(false);
    setShown(options?.find((o) => o.id === id)?.displayName ?? "—");
    setError(null);
    try {
      await onSave(id);
    } catch (err) {
      setShown(previous);
      setError(err instanceof Error ? err.message : "Could not save that");
    }
  }

  if (open) {
    return options ? (
      <select
        ref={selectRef}
        defaultValue={valueId ?? ""}
        onChange={(e) => void choose(e.target.value)}
        onBlur={() => setOpen(false)}
        aria-label="Additive"
        className="max-w-[11rem] rounded-md border border-ring/60 bg-background px-1.5 py-0.5 text-[13px] text-foreground outline-none"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.displayName}
          </option>
        ))}
      </select>
    ) : (
      <span className="text-[13px] text-muted-foreground">Loading…</span>
    );
  }

  const empty = shown.trim() === "" || shown === "—";

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={`Additive: ${empty ? "not set" : shown}. Tap to change.`}
        className={cn(
          "tap-active -mx-1 rounded-md px-1 text-right text-[13px] transition-colors",
          // Always underlined — see the note in `InlineValueEdit`.
          "underline decoration-dotted decoration-muted-foreground/45 underline-offset-4 hover:bg-muted/60 hover:decoration-foreground",
          empty ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {empty ? "—" : shown}
      </button>
      {error ? (
        <span role="alert" className="text-[11px] leading-tight text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
