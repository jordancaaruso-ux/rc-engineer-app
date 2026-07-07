"use client";

import type { RunPickerRun } from "@/lib/runPickerFormat";
import { formatRunPickerLine } from "@/lib/runPickerFormat";
import { SearchableSelect } from "@/components/ui/SearchableSelect";

export function RunPickerSelect({
  label = "",
  runs,
  value,
  onChange,
  placeholder = "Select a past run…",
  disabled,
  formatLine = formatRunPickerLine,
}: {
  label?: string;
  runs: RunPickerRun[];
  value: string;
  onChange: (runId: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Default: context-first scan line + best lap. Use formatRunPickerLineRelativeWhen for Load setup (same shape). */
  formatLine?: (run: RunPickerRun) => string;
}) {
  return (
    <div className="space-y-1 text-sm">
      {label ? (
        <div className="text-sm font-medium text-muted-foreground break-words min-w-0 leading-snug">{label}</div>
      ) : null}
      <SearchableSelect
        aria-label={label || placeholder}
        className="max-w-2xl"
        placeholder={placeholder}
        clearable
        clearLabel={placeholder}
        triggerMono
        disabled={disabled}
        value={value}
        onChange={onChange}
        options={runs.map((r) => ({ value: r.id, label: formatLine(r) }))}
      />
    </div>
  );
}
