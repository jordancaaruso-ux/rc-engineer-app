"use client";

import { useMemo, useState } from "react";
import { PickerSheet, PickerTrigger } from "@/components/ui/PickerSheet";
import type { OptionSection } from "@/lib/search/optionSearch";
import {
  STOCK_INSERT,
  TIRE_FITMENT_MODS_MAX,
  TIRE_FITMENT_NAME_MAX,
  type TireFitmentEnd,
} from "@/lib/tires/tireFitment";

/**
 * What one end's tire is glued to: its insert, its wheel, and anything done to either.
 *
 * Founder rulings, 2026-09-19 (see `tireFitment.ts`): insert and wheel are the driver's OWN list
 * that remembers — typed once, a tap ever after — and modifications are ONE free-text box, not
 * hole-size and hole-count fields. Nothing here is required; a driver who only ever logs the
 * tire never has to touch this row.
 *
 * No labels and no helper text: the empty controls name themselves ("Insert", "Wheel",
 * "Modifications"). A filled one shows the value alone — driven at 390px, a name prefix left half
 * a box for the value and cut "Dirt-Tech" to "Dirt-Te…". Insert is always the left box and wheel
 * the right, the words are the driver's own, and the sheet each opens is titled.
 */

/** De-duplicated, case-insensitively, first spelling wins. */
function uniqueNames(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const name = v?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * A picker over a list that has no table behind it. Choosing a row and typing a new name are
 * the same act — the value is just the string — so "create" is nothing but handing the search
 * text back. It exists for the next run the moment this one is saved.
 */
function OwnListPicker({
  name,
  ariaLabel,
  value,
  options,
  onChange,
}: {
  /** "Insert" | "Wheel" — the placeholder, the prefix, and the sheet's title. */
  name: string;
  ariaLabel: string;
  value: string | null;
  options: readonly string[];
  onChange: (next: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  const sections = useMemo<OptionSection[]>(
    () => [
      {
        key: "own",
        label: null,
        options: uniqueNames([...options, value]).map((o) => ({ value: o, label: o })),
      },
    ],
    [options, value]
  );

  const commit = (raw: string) => {
    const next = raw.replace(/\s+/g, " ").trim().slice(0, TIRE_FITMENT_NAME_MAX).trim();
    onChange(next || null);
    setOpen(false);
  };

  return (
    <div className="min-w-0">
      <PickerTrigger
        onClick={() => setOpen(true)}
        open={open}
        aria-label={ariaLabel}
        placeholder={!value}
        className="rounded-md border border-border bg-card"
      >
        {value ?? name}
      </PickerTrigger>
      <PickerSheet
        open={open}
        onClose={() => setOpen(false)}
        title={name}
        value={value ?? ""}
        onSelect={commit}
        sections={sections}
        searchPlaceholder={`Search or type a new ${name.toLowerCase()}…`}
        clearRow={value ? { label: "None" } : null}
        emptyAction={(q) =>
          q ? (
            <button
              type="button"
              onClick={() => commit(q)}
              className="tap-active rounded-md border border-primary-ink/40 px-3 py-2 text-[13px] font-semibold text-primary-ink hover:bg-muted/50"
            >
              {`Use “${q}”`}
            </button>
          ) : null
        }
        searchAction={{
          label: `Use what you typed as the ${name.toLowerCase()}`,
          onAction: (q) => {
            if (q) commit(q);
          },
        }}
      />
    </div>
  );
}

export function TireFitmentRow({
  endName,
  value,
  onChange,
  inserts,
  wheels,
}: {
  /** "Front" | "Rear" — only for the controls' accessible names. */
  endName: string;
  value: TireFitmentEnd;
  onChange: (next: TireFitmentEnd) => void;
  /** The driver's own inserts, newest first. "Stock" is added here; callers need not. */
  inserts: readonly string[];
  wheels: readonly string[];
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <OwnListPicker
          name="Insert"
          ariaLabel={`${endName} insert`}
          value={value.insert}
          options={[STOCK_INSERT, ...inserts]}
          onChange={(insert) => onChange({ ...value, insert })}
        />
        <OwnListPicker
          name="Wheel"
          ariaLabel={`${endName} wheel`}
          value={value.wheel}
          options={wheels}
          onChange={(wheel) => onChange({ ...value, wheel })}
        />
      </div>
      <input
        type="text"
        value={value.mods ?? ""}
        onChange={(e) => onChange({ ...value, mods: e.target.value || null })}
        maxLength={TIRE_FITMENT_MODS_MAX}
        placeholder="Modifications"
        aria-label={`${endName} modifications`}
        autoCapitalize="sentences"
        className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
