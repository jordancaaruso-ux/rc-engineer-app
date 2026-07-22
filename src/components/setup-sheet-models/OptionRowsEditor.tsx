"use client";

import { useState } from "react";

/**
 * Declare a choice parameter's options as *rows*, not as free text.
 *
 * The sheets this builds are real branded setup sheets, where a choice is a printed row of boxes:
 * you know there are four of them before you know what they say. So the primary control is "how
 * many options", then one input per option — which is much harder to get subtly wrong than a
 * newline-delimited textarea (a stray blank line silently changed the option count).
 *
 * The textarea survives behind "Paste a list" for bulk entry off a PDF.
 */

const MAX_OPTIONS = 24;

export function OptionRowsEditor({
  options,
  onChange,
  idPrefix,
}: {
  options: string[];
  onChange: (next: string[]) => void;
  /** Distinguishes label/input ids when two editors are mounted at once. */
  idPrefix: string;
}) {
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const setCount = (count: number) => {
    const clamped = Math.max(0, Math.min(MAX_OPTIONS, count));
    if (clamped === options.length) return;
    const next = [...options];
    while (next.length < clamped) next.push("");
    next.length = clamped;
    onChange(next);
  };

  const setAt = (index: number, value: string) => {
    const next = [...options];
    next[index] = value;
    onChange(next);
  };

  const removeAt = (index: number) => {
    onChange(options.filter((_, i) => i !== index));
  };

  if (pasteMode) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Paste one option per line</span>
          <button
            type="button"
            className="text-[10px] text-sky-300 hover:underline"
            onClick={() => setPasteMode(false)}
          >
            Back to rows
          </button>
        </div>
        <textarea
          className="min-h-[5rem] w-full rounded border border-border bg-card px-2 py-1.5 font-mono"
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder={"1\n2\n3\n4"}
        />
        <button
          type="button"
          className="rounded border border-sky-500/60 bg-sky-500/15 px-2.5 py-1 text-[11px] font-medium"
          onClick={() => {
            const parsed = pasteText
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter(Boolean)
              .slice(0, MAX_OPTIONS);
            if (parsed.length) onChange(parsed);
            setPasteText("");
            setPasteMode(false);
          }}
        >
          Use these {pasteText.split(/\r?\n/).filter((l) => l.trim()).length || 0} options
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">How many options?</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="h-6 w-6 rounded border border-border text-sm leading-none disabled:opacity-40"
            onClick={() => setCount(options.length - 1)}
            disabled={options.length === 0}
            aria-label="One fewer option"
          >
            −
          </button>
          <input
            className="w-12 rounded border border-border bg-card px-1.5 py-1 text-center font-mono"
            inputMode="numeric"
            value={options.length}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(n)) setCount(n);
            }}
            aria-label="Number of options"
          />
          <button
            type="button"
            className="h-6 w-6 rounded border border-border text-sm leading-none disabled:opacity-40"
            onClick={() => setCount(options.length + 1)}
            disabled={options.length >= MAX_OPTIONS}
            aria-label="One more option"
          >
            +
          </button>
        </div>
        <button
          type="button"
          className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
          onClick={() => setPasteMode(true)}
        >
          Paste a list
        </button>
      </div>

      {options.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">
          A choice parameter needs at least two options.
        </p>
      ) : (
        <ul className="space-y-1">
          {options.map((opt, i) => (
            <li key={`${idPrefix}-opt-${i}`} className="flex items-center gap-1.5">
              <span className="w-4 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                {i + 1}
              </span>
              <input
                className="min-w-0 flex-1 rounded border border-border bg-card px-2 py-1"
                value={opt}
                onChange={(e) => setAt(i, e.target.value)}
                placeholder={`Option ${i + 1}`}
                aria-label={`Option ${i + 1}`}
              />
              <button
                type="button"
                className="shrink-0 px-1 text-[10px] text-muted-foreground hover:text-rose-300"
                onClick={() => removeAt(i)}
                aria-label={`Remove option ${i + 1}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
