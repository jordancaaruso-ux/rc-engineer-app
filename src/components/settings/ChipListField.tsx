"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SaveState } from "@/components/settings/SettingsClient";

/**
 * A setting whose value is a set, edited as removable pills.
 *
 * Both halves of the Speedhive identity are sets and always were — the matcher
 * tests every chip and every name — but each was a single-line text box, so
 * nothing on screen said a second value was allowed and nothing confirmed what
 * the server had understood. A driver owns several chips and appears under
 * several spellings; the point of this control is that you enter all of them
 * once and stop thinking about it.
 *
 * `parse` and `format` are handed in, and are always the *same functions the
 * server uses*, so the pills are literally what will match rather than a
 * hopeful client-side approximation. Merging re-runs the pair over the combined
 * text, which means the caller's own canonical form decides what counts as a
 * duplicate — normalized name equality for names, numeric equality for chips —
 * instead of this component inventing a second, weaker rule.
 */
export function ChipListField<T extends string | number>({
  label,
  initialText,
  parse,
  format,
  onSave,
  state,
  placeholder,
  addAnotherPlaceholder = "Add another…",
  hint,
  invalidHint,
  inputMode,
  commitKeys = ["Enter"],
  chipMono = false,
  id,
}: {
  label: string;
  initialText: string;
  /** The server's own parser. One value or a pasted list — both go through it. */
  parse: (raw: string | null) => T[];
  /** Inverse of `parse`; what gets persisted. */
  format: (values: T[]) => string;
  /** Persists the whole set. `null` clears it. */
  onSave: (text: string | null) => Promise<boolean>;
  state: SaveState;
  placeholder?: string;
  addAnotherPlaceholder?: string;
  hint: string;
  /** Shown when what was typed parses to nothing. */
  invalidHint: string;
  inputMode?: "numeric" | "text";
  /**
   * Keys that commit the draft. Numbers add comma and space, because that is how
   * people separate them; names must not, because a name contains spaces and
   * timing sheets print "Caruso, Jordan".
   */
  commitKeys?: string[];
  chipMono?: boolean;
  id: string;
}) {
  const [values, setValues] = useState<T[]>(() => parse(initialText));
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);

  function persist(next: T[]) {
    setValues(next);
    void onSave(next.length > 0 ? format(next) : null);
  }

  function commitDraft() {
    const text = draft.trim();
    if (!text) return;
    const parsed = parse(text);
    if (parsed.length === 0) {
      setNote(invalidHint);
      return;
    }
    const merged = parse(format([...values, ...parsed]));
    setDraft("");
    if (merged.length === values.length) {
      setNote("Already saved.");
      return;
    }
    setNote(null);
    persist(merged);
  }

  function remove(value: T) {
    setNote(null);
    persist(values.filter((v) => v !== value));
  }

  return (
    <div className="space-y-1 text-sm">
      <label className="block text-sm font-medium text-foreground" htmlFor={id}>
        {label}
      </label>

      {values.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5 pb-1" aria-label={`Saved ${label.toLowerCase()}`}>
          {values.map((v) => (
            <li key={String(v)} className="min-w-0 max-w-full">
              <span
                className={cn(
                  "inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/60 py-1 pl-2.5 pr-1 text-[12.5px] text-foreground",
                  chipMono && "tabular-nums"
                )}
              >
                <span className="min-w-0 truncate">{String(v)}</span>
                <button
                  type="button"
                  onClick={() => remove(v)}
                  aria-label={`Remove ${String(v)}`}
                  className="tap-active flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3.5" strokeWidth={2.5} aria-hidden />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          id={id}
          type="text"
          inputMode={inputMode}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setNote(null);
          }}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (commitKeys.includes(e.key)) {
              e.preventDefault();
              commitDraft();
              return;
            }
            // Backspace on an empty box takes the last pill, as every chip input does.
            if (e.key === "Backspace" && !draft && values.length > 0) {
              e.preventDefault();
              remove(values[values.length - 1]!);
            }
          }}
          placeholder={values.length > 0 ? addAnotherPlaceholder : placeholder}
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary-ink/50"
        />
        {state.kind === "saving" ? (
          <span className="ui-caption text-muted-foreground">Saving…</span>
        ) : null}
        {state.kind === "ok" ? <span className="ui-caption text-emerald-600">Saved.</span> : null}
        {state.kind === "error" ? (
          <span className="ui-caption text-destructive">{state.text}</span>
        ) : null}
      </div>

      <p className={cn("ui-caption", note ? "text-destructive" : "text-muted-foreground")}>
        {note ?? hint}
      </p>
    </div>
  );
}
