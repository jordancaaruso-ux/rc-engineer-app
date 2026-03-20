"use client";

import type { RunPickerRun } from "@/lib/runPickerFormat";
import { formatRunPickerLine } from "@/lib/runPickerFormat";

export function RunPickerSelect({
  label,
  runs,
  value,
  onChange,
  placeholder = "Select a past run…",
  disabled,
  formatLine = formatRunPickerLine,
}: {
  label: string;
  runs: RunPickerRun[];
  value: string;
  onChange: (runId: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Default: absolute date+time. Use formatRunPickerLineRelativeWhen for Load setup. */
  formatLine?: (run: RunPickerRun) => string;
}) {
  return (
    <div className="space-y-1 text-sm">
      {label ? (
        <div className="text-xs font-mono text-muted-foreground break-words min-w-0 leading-snug">{label}</div>
      ) : null}
      <select
        className="w-full max-w-2xl rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs outline-none font-mono"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {runs.map((r) => (
          <option key={r.id} value={r.id} title={formatLine(r)}>
            {formatLine(r)}
          </option>
        ))}
      </select>
    </div>
  );
}
