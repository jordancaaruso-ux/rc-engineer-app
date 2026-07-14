"use client";

import { cn } from "@/lib/utils";

export type SearchableSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  /** @deprecated retained for API compat; native select has no in-list search. */
  keywords?: string;
};

export type SearchableSelectGroup = {
  label: string;
  options: SearchableSelectOption[];
};

/**
 * Value picker — a native `<select>` (went fully native 2026-07-14: the OS draws
 * the menu, so on iPhone there's no floating popover, no keyboard, and no
 * rubber-banding on touch scroll — the feel the founder wanted).
 *
 * Keeps the previous prop API so every call site is untouched. `searchable` and
 * option `keywords` are accepted but ignored (type-to-search is a later bridge).
 * `groups` render as `<optgroup>`; `clearable` adds a selectable blank row,
 * otherwise the placeholder is a disabled first option.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  groups,
  placeholder = "Select…",
  "aria-label": ariaLabel,
  disabled,
  className,
  clearable = false,
  clearLabel = "—",
  triggerMono = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options?: SearchableSelectOption[];
  groups?: SearchableSelectGroup[];
  placeholder?: string;
  "aria-label"?: string;
  disabled?: boolean;
  className?: string;
  /** @deprecated no-op — native select has no in-list search. */
  searchable?: boolean;
  clearable?: boolean;
  clearLabel?: string;
  /** Render the trigger + options in mono (setup/document lists). */
  triggerMono?: boolean;
}) {
  const renderOption = (o: SearchableSelectOption) => (
    <option key={o.value} value={o.value} disabled={o.disabled}>
      {o.label}
    </option>
  );

  return (
    <select
      aria-label={ariaLabel}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "form-control w-full px-3 py-2 text-sm disabled:opacity-60",
        triggerMono && "font-mono",
        className
      )}
    >
      {clearable ? (
        <option value="">{clearLabel}</option>
      ) : (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {groups?.length
        ? groups.map((g) => (
            <optgroup key={g.label || "_"} label={g.label}>
              {g.options.map(renderOption)}
            </optgroup>
          ))
        : (options ?? []).map(renderOption)}
    </select>
  );
}
