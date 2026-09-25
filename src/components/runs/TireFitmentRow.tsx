"use client";

import { useEffect, useMemo, useState } from "react";
import { PickerSheet, PickerTrigger } from "@/components/ui/PickerSheet";
import type { OptionSection } from "@/lib/search/optionSearch";
import {
  STOCK_INSERT,
  TIRE_FITMENT_MODS_MAX,
  TIRE_FITMENT_NAME_MAX,
  formatTireDiameterMm,
  parseTireDiameterMm,
  type TireEndBox,
  type TireFitmentEnd,
} from "@/lib/tires/tireFitment";

/**
 * What one end's tire is glued to: its insert, its wheel, its diameter, and anything done to
 * any of them. Which of those boxes an end shows is the car class's call (`TireProfile.boxes`,
 * founder call 2026-09-25): off-road gets insert + wheel, foam and on-road front/rear classes get
 * the diameter, and every class that logs front and rear gets Modifications.
 *
 * Founder rulings, 2026-09-19 (see `tireFitment.ts`): insert and wheel are the driver's OWN list
 * that remembers — typed once, a tap ever after — and modifications are ONE free-text box, not
 * hole-size and hole-count fields. Nothing here is required; a driver who only ever logs the
 * tire never has to touch this row.
 *
 * No labels and no helper text: the empty controls name themselves ("Insert", "Wheel",
 * "Diameter (mm)", "Modifications"). A filled one shows the value alone — driven at 390px, a name
 * prefix left half a box for the value and cut "Dirt-Tech" to "Dirt-Te…". Insert is always the
 * left box and wheel the right, the words are the driver's own, and the sheet each opens is titled.
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

const TEXT_BOX_CLASS =
  "w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground";

/**
 * The trued diameter, in millimetres. The box keeps what the driver is typing ("42." on the way
 * to "42.5", or a decimal comma) and hands the parent the number it reads as, or null. It only
 * rewrites its text when the value arrives from outside — a carried-forward run, a restored draft.
 *
 * Unlike an insert or wheel NAME, a bare "42.5" says nothing on its own (driven at 390px, it read
 * as any number at all), so a filled box keeps "Diameter" in front and "mm" behind. The row is
 * the control: `search-row-composite` hands the global input focus ring to the wrapper.
 */
function DiameterBox({
  endName,
  value,
  onChange,
}: {
  endName: string;
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  const [text, setText] = useState(value != null ? formatTireDiameterMm(value) : "");
  useEffect(() => {
    setText((current) =>
      parseTireDiameterMm(current) === value ? current : value != null ? formatTireDiameterMm(value) : ""
    );
  }, [value]);
  const filled = text.trim() !== "";
  return (
    <label className="search-row-composite flex w-full cursor-text items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm focus-within:border-ring/45 focus-within:ring-2 focus-within:ring-ring/35">
      {filled ? <span aria-hidden className="shrink-0 text-muted-foreground">Diameter</span> : null}
      {/* The input hugs its text so "mm" sits right after the number: an invisible copy of the
          text sizes the grid cell the input shares. Same element either way — swapping the
          wrapper on the first keystroke would drop focus mid-typing. */}
      <span className="inline-grid min-w-0">
        <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-pre">
          {text || "Diameter (mm)"}
        </span>
        <input
          type="text"
          inputMode="decimal"
          size={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onChange(parseTireDiameterMm(e.target.value));
          }}
          onBlur={() => setText(value != null ? formatTireDiameterMm(value) : "")}
          maxLength={8}
          placeholder="Diameter (mm)"
          aria-label={`${endName} diameter in millimetres`}
          className="col-start-1 row-start-1 w-full min-w-0 bg-transparent p-0 text-foreground outline-none placeholder:text-muted-foreground"
        />
      </span>
      {filled ? <span aria-hidden className="shrink-0 text-muted-foreground">mm</span> : null}
    </label>
  );
}

export function TireFitmentRow({
  endName,
  boxes,
  value,
  onChange,
  inserts,
  wheels,
}: {
  /** "Front" | "Rear" — only for the controls' accessible names. */
  endName: string;
  /** Which boxes this end shows, in screen order — the car class's, plus any holding a value. */
  boxes: readonly TireEndBox[];
  value: TireFitmentEnd;
  onChange: (next: TireFitmentEnd) => void;
  /** The driver's own inserts, newest first. "Stock" is added here; callers need not. */
  inserts: readonly string[];
  wheels: readonly string[];
}) {
  const showInsert = boxes.includes("insert");
  const showWheel = boxes.includes("wheel");
  return (
    <div className="space-y-2">
      {showInsert || showWheel ? (
        <div className={showInsert && showWheel ? "grid grid-cols-2 gap-2" : undefined}>
          {showInsert ? (
            <OwnListPicker
              name="Insert"
              ariaLabel={`${endName} insert`}
              value={value.insert}
              options={[STOCK_INSERT, ...inserts]}
              onChange={(insert) => onChange({ ...value, insert })}
            />
          ) : null}
          {showWheel ? (
            <OwnListPicker
              name="Wheel"
              ariaLabel={`${endName} wheel`}
              value={value.wheel}
              options={wheels}
              onChange={(wheel) => onChange({ ...value, wheel })}
            />
          ) : null}
        </div>
      ) : null}
      {boxes.includes("diameter") ? (
        <DiameterBox
          endName={endName}
          value={value.diameterMm}
          onChange={(diameterMm) => onChange({ ...value, diameterMm })}
        />
      ) : null}
      {boxes.includes("mods") ? (
        <input
          type="text"
          value={value.mods ?? ""}
          onChange={(e) => onChange({ ...value, mods: e.target.value || null })}
          maxLength={TIRE_FITMENT_MODS_MAX}
          placeholder="Modifications"
          aria-label={`${endName} modifications`}
          autoCapitalize="sentences"
          className={TEXT_BOX_CLASS}
        />
      ) : null}
    </div>
  );
}
