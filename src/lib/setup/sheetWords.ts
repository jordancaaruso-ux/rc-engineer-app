import { DEFAULT_SETUP_FIELDS } from "@/lib/runSetup";
import { normalizeGroupedFieldOnField } from "@/lib/setupSheetModels/enrichGroupedFieldOptions";
import type { SetupSheetModelFieldDef } from "@/lib/setupSheetModels/types";

/** The units `setupFieldLabel` has always printed, for a sheet that names a box but gives none. */
const DEFAULT_UNIT_BY_KEY = new Map(DEFAULT_SETUP_FIELDS.map((f) => [f.key, f.unit ?? ""] as const));

/**
 * The words a chassis's own sheet uses — each box's name and each printed choice — for every
 * surface that PRINTS a setup value or a change to one.
 *
 * A stored setup holds keys and codes: `anti_roll_bar_front` = `f_1_3`. The code is the schema's
 * stored value for a choice (`groupedOptionValueFromLabel` makes `f_1_3` out of "1.3"), and no
 * driver has ever seen it. The Mi10 sheet's buttons read 1.1 to 1.4 under "Anti Roll Bar (Front)",
 * and the dashboard, the run page and the team feed printed "anti roll bar front f_1_3 → f_1_4"
 * (test drive, 2026-09-26). Only the A800RR's names were known to those lists.
 *
 * Plain data, so a route can hand it to the browser as JSON. Pure: no Prisma, no React.
 */
export type SheetWords = {
  /** key → the box's name on this sheet ("Anti Roll Bar (Front)"). */
  labels: Record<string, string>;
  /** key → its unit, where the sheet declares one. */
  units: Record<string, string>;
  /**
   * key → (stored code → the choice as printed). Only for choices whose stored code is not already
   * the printed word, so most sheets carry nothing here. Codes are compared the way the sheet
   * surface compares them (`optionCode`).
   */
  options: Record<string, Record<string, string>>;
};

/**
 * One stored choice, in the form codes are compared in: case, spacing and the hyphen/underscore
 * difference ignored — the same equivalence `sheetSurfaceValues` uses ("c01b_rsl" is "C01B-RSL").
 */
function optionCode(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ").replace(/[-_]+/g, "-");
}

/**
 * An entry the record really holds. These records arrive as parsed JSON, and a box or a choice
 * that happens to be called "constructor" must not read the object's own machinery.
 */
function own<T>(record: Record<string, T> | undefined, key: string): T | undefined {
  return record && Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

/** The sheet's own name for a box, if it has one. */
export function sheetBoxName(words: SheetWords | null | undefined, key: string): string | undefined {
  return own(words?.labels, key);
}

/** The sheet's unit for a box, if it gives one. */
export function sheetBoxUnit(words: SheetWords | null | undefined, key: string): string | undefined {
  return own(words?.units, key);
}

/** Is this box a row of printed choices whose stored codes are not the printed words? */
export function sheetBoxHasChoiceWords(words: SheetWords | null | undefined, key: string): boolean {
  return own(words?.options, key) !== undefined;
}

/**
 * The words of a chassis's field list. `onlyKeys` keeps a route's answer to the boxes it was asked
 * about. A later field wins over an earlier one with the same key, so an edition's own fields can
 * be passed after the chassis's.
 */
export function sheetWordsFromFields(
  fields: readonly SetupSheetModelFieldDef[],
  onlyKeys?: ReadonlySet<string>
): SheetWords {
  const words: SheetWords = { labels: {}, units: {}, options: {} };
  for (const raw of fields) {
    if (onlyKeys && !onlyKeys.has(raw.key)) continue;
    const field = normalizeGroupedFieldOnField(raw);
    const key = field.key;
    delete words.labels[key];
    delete words.units[key];
    delete words.options[key];

    const label = field.displayLabel?.trim();
    if (label) words.labels[key] = label;
    const unit = field.unit?.trim();
    if (unit) words.units[key] = unit;

    const printed = field.groupedOptionLabels ?? [];
    const stored = field.groupedOptionValues ?? [];
    const byCode: Record<string, string> = {};
    if (printed.length >= 2 && stored.length === printed.length) {
      printed.forEach((word, i) => {
        const shown = word.trim();
        const code = optionCode(stored[i] ?? "");
        if (shown && code && code !== optionCode(shown)) byCode[code] = shown;
      });
    }
    if (Object.keys(byCode).length > 0) words.options[key] = byCode;
  }
  return words;
}

/**
 * A value as the sheet prints it: `f_1_3` → "1.3", and a many-of-many "f_a, f_b" choice by choice.
 * Anything the sheet has no word for — a typed number, "—" — comes back exactly as it went in.
 */
export function sheetValue(words: SheetWords | null | undefined, key: string, shown: string): string {
  const options = own(words?.options, key);
  if (!options) return shown;
  const whole = own(options, optionCode(shown));
  if (whole) return whole;
  if (!shown.includes(",")) return shown;
  const tokens = shown
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.some((t) => own(options, optionCode(t)))) return shown;
  return tokens.map((t) => own(options, optionCode(t)) ?? t).join(", ");
}

/**
 * The box's name as a change list prints it: the sheet's own name, with a unit the way
 * `setupFieldLabel` adds one ("Ride height (mm)"). The unit is the sheet's, or else the one the
 * list always printed for that key. Null when the sheet has no name for the key.
 */
export function sheetLabel(words: SheetWords | null | undefined, key: string): string | null {
  const label = sheetBoxName(words, key);
  if (!label) return null;
  const unit = sheetBoxUnit(words, key) || DEFAULT_UNIT_BY_KEY.get(key);
  return unit ? `${label} (${unit})` : label;
}

/**
 * Change-list rows in the sheet's own words. A row the sheet has no name for keeps the one it
 * came with; a row is never added, dropped or reordered here.
 */
export function inSheetWords<T extends { key: string; label: string; value: string; previousValue: string }>(
  rows: T[],
  words: SheetWords | null | undefined
): T[] {
  if (!words) return rows;
  return rows.map((row) => ({
    ...row,
    label: sheetLabel(words, row.key) ?? row.label,
    value: sheetValue(words, row.key, row.value),
    previousValue: sheetValue(words, row.key, row.previousValue),
  }));
}
