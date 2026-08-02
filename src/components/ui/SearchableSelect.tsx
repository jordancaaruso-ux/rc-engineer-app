"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { PickerSheet, PickerTrigger } from "@/components/ui/PickerSheet";
import { PICKER_SEARCH_THRESHOLD, type OptionSection } from "@/lib/search/optionSearch";

export type SearchableSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  /** Matched by search but never shown — codes, aliases, a driver's name. */
  keywords?: string;
};

export type SearchableSelectGroup = {
  label: string;
  options: SearchableSelectOption[];
};

/**
 * Value picker — native `<select>` for short lists, searchable sheet for long
 * ones. Same prop API either way, so no call site has to know which it gets.
 *
 * The native menu isn't a fallback here, it's the right control below the
 * threshold: most call sites are three-option setup fields, and a modal that
 * takes over the screen to offer three things would be a worse app everywhere
 * except the handful of lists that actually needed searching. See
 * `PICKER_SEARCH_THRESHOLD` for where the line sits and why.
 *
 * `searchable` is no longer a no-op: pass `true` to force the sheet on a short
 * list, `false` to keep the native menu on a long one. Left unset, the length
 * decides.
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
  searchable,
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
  /** Force the search sheet on (or off). Unset = decided by list length. */
  searchable?: boolean;
  clearable?: boolean;
  clearLabel?: string;
  /** Render the trigger + options in mono (setup/document lists). */
  triggerMono?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const flat = useMemo(
    () => (groups?.length ? groups.flatMap((g) => g.options) : (options ?? [])),
    [groups, options]
  );
  const sections = useMemo<OptionSection[]>(
    () =>
      groups?.length
        ? groups.map((g, i) => ({ key: g.label || `group-${i}`, label: g.label || null, options: g.options }))
        : [{ key: "all", label: null, options: options ?? [] }],
    [groups, options]
  );

  const useSheet = searchable ?? flat.length > PICKER_SEARCH_THRESHOLD;
  const selected = flat.find((o) => o.value === value) ?? null;

  if (useSheet) {
    return (
      <>
        <PickerTrigger
          onClick={() => setOpen(true)}
          disabled={disabled}
          open={open}
          aria-label={ariaLabel}
          mono={triggerMono}
          placeholder={!selected}
          className={cn("form-control", className)}
        >
          {selected?.label ?? (clearable ? clearLabel : placeholder)}
        </PickerTrigger>

        <PickerSheet
          open={open}
          onClose={() => setOpen(false)}
          title={ariaLabel ?? placeholder}
          value={value}
          onSelect={(next) => {
            onChange(next);
            setOpen(false);
          }}
          sections={sections}
          searchPlaceholder="Search…"
          clearRow={clearable ? { label: clearLabel } : null}
          mono={triggerMono}
        />
      </>
    );
  }

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
