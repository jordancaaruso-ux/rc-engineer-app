import { normalizeSetupData } from "@/lib/runSetup";
import { parseDiscipline } from "@/lib/cars/carClasses";
import { isRunContextSetupKey } from "@/lib/setup/runContextSetupKeys";
import { isTuningComparisonKey } from "@/lib/setupComparison/tuningComparisonKeys";

/**
 * How the Engineer's data blocks read a setup sheet and say what moved between two of them.
 * Shared by the per-run block (driverData.ts) and the range block (driverHistory.ts) so the
 * two can never disagree about what counts as a change.
 */

export function fmtSetupValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v === "string") {
    const s = v.trim();
    return s.length > 0 && s.length <= 60 ? s : null;
  }
  if (typeof v === "boolean") return v ? "yes" : "no";
  return null;
}

/**
 * Sheet abbreviations that name a part, spelled out — only as the founder names them. HRB is the
 * rear body height (founder, 2026-09-23). The same evening this table said "hydraulic roll bar",
 * taken from a wrong code comment without asking him: the Engineer had read the bare "rear hrb
 * setting" correctly in both answers, and the table taught it the wrong part. What a box IS is a
 * fact about the car — the first entry of the sheet contract (each box: what it adjusts, which end,
 * which way is more) — so an entry here comes from the founder or the manufacturer's sheet, never
 * from a guess.
 */
const PART_NAMES: ReadonlyArray<[RegExp, string]> = [[/\brear hrb\b/, "rear body height (HRB)"]];

/** `front_spring_rate_gf_mm` -> `front spring rate gf mm` — readable without inventing a label. */
export function readableSetupKey(key: string): string {
  let s = key.replace(/[_\-]+/g, " ").trim();
  for (const [abbr, name] of PART_NAMES) s = s.replace(abbr, name);
  return s;
}

/**
 * The body on the car. The shared tuning list leaves these out because its other readers are
 * setup statistics, where a shell name is not a number to aggregate. To the Engineer a new shell
 * is a change the driver made: until 2026-09-19 a run whose only change was the body printed
 * "no setup change", and the Engineer asked a driver what he had tried on the run he tried it.
 */
const ENGINEER_BODY_KEYS = new Set<string>(["bodyshell", "wing", "winglet"]);

/**
 * Gearing and the motor. Left out of the shared tuning list for the same reason as the body, and
 * hidden from the Engineer until 2026-09-21: a driver with spur 66, pinion 39 and a 21.5T on his
 * sheet asked "What fdr for 21.5T" and was told "there's no current ratio… What FDR are you running
 * now?" — the app asking a driver for a number he had already given it (founder: "sure").
 * The spellings are the ones the chassis sheets in production actually use.
 */
const ENGINEER_DRIVETRAIN_KEYS = new Set<string>([
  "spur",
  "spur_gear",
  "spurgear",
  "pinion",
  "fdr",
  "motor",
  "motor_timing",
]);

/**
 * Roll bars as the Schumacher Mi10's sheet spells them. The shared tuning list knows a bar only as
 * `arb_…` (the A800RR's spelling), so a Mi10 driver who moved his front bar 1.3 → 1.4 and back was
 * told three times that nothing on the car had changed (test drive, 2026-09-26). Engineer-only, like
 * the body and the gearing: the shared list also decides which boxes join the setup statistics.
 */
const ENGINEER_ROLL_BAR_KEYS = new Set<string>(["anti_roll_bar_front", "anti_roll_bar_rear"]);

/** What the Engineer reads off a sheet: the tuning keys, the roll bars, the body, the gearing and the motor. */
export function isEngineerSetupKey(key: string): boolean {
  return (
    isTuningComparisonKey(key) ||
    ENGINEER_ROLL_BAR_KEYS.has(key) ||
    ENGINEER_BODY_KEYS.has(key) ||
    ENGINEER_DRIVETRAIN_KEYS.has(key)
  );
}

/**
 * Boxes on a sheet that are not a setting on the car: who, when and where, and the notes (the
 * "Other" rows of the app's own sheets, setupSheetGroups.ts, and the same boxes as other sheets name
 * them), the conditions, and the battery. With the tyres, additive and prep the run form writes in
 * from the Tires tab (`isRunContextSetupKey`: no "what changed" list may count them), a change in one
 * of these is never a setup change.
 */
const NOT_A_SETTING = new Set<string>([
  "battery",
  "driver",
  "driver_name",
  "setup_date",
  "date",
  "event",
  "race",
  "round",
  "heat",
  "result",
  "track",
  "track_surface",
  "track_layout",
  "layout",
  "surface",
  "traction",
  "grip",
  "weather",
  "temperature",
  "air_temp",
  "track_temp",
  "humidity",
  "notes",
  "note",
  "body_notes",
  "comments",
]);
/** A box that holds the tyre itself, typed on the sheet: `tires`, `tyre_front`, `rear_tires`. */
const TYRE_BOX = /^(front_|rear_)?(tire|tyre)s?(_front|_rear)?$/;

/** A box whose change is a change to the car: every box but the tyres, the battery, the notes and the session's. */
export function isSettingBox(key: string): boolean {
  return !isRunContextSetupKey(key) && !NOT_A_SETTING.has(key) && !TYRE_BOX.test(key);
}

/**
 * The chips a chassis's sheet offers per box: the labels the driver taps and the token stored for
 * each (buildSetupSheetTemplate `fieldChipOptionsByKey`; driverData `sheetChipsOf`). The Mi10's front
 * bar chip "1.3" is stored as `f_1_3`, and a code the driver never saw must not reach the Engineer
 * as the value the car ran.
 */
export type SheetChips = Readonly<Record<string, { options: readonly string[]; optionValues?: readonly string[] }>>;

/** A stored chip token as its chip reads ("f_1_3" → "1.3"); any other value, or one that differs only by case, as stored. */
function chipLabel(value: string, chip: SheetChips[string] | undefined): string {
  const values = chip?.optionValues;
  if (!chip || !values || values.length !== chip.options.length) return value;
  const token = value.trim().toLowerCase();
  const label = chip.options[values.findIndex((v) => v.trim().toLowerCase() === token)]?.trim();
  return label && label.toLowerCase() !== token ? label : value;
}

/**
 * Fewer boxes than this that the Engineer can read, and it cannot read the sheet: what it sees is
 * the gearing, the motor, the body — a box or two — and not one spring, bar, oil or geometry
 * setting. Every Xray X4, the ARC A11 and most Schumachers are here; an A800RR shows 60-odd.
 */
export const MIN_READABLE_BOXES = 20;

/**
 * A sheet split by what the Engineer is shown: `read` is `tuningValues`; `unread` is every other box
 * with something in it — a box on a chassis sheet the app has not learned yet ("text20"), or one it
 * never shows (tyres, battery, notes).
 *
 * `names` are the driver's own names for unread boxes on this car (carSheetNames.ts, founder
 * 2026-09-25: "their car at once"). A named box stays in `unread` — the app still cannot read the
 * chassis's sheet, so whether the sheet counts as read (`sheetMostlyUnread`) does not move — but it
 * is SHOWN, under the driver's name, instead of counted as a box not shown.
 */
export type SheetRead = {
  read: Record<string, string>;
  unread: Record<string, string>;
  names?: Record<string, string>;
};

export function readSheet(
  data: unknown,
  names?: Readonly<Record<string, string>> | null,
  /** The chassis sheet's chips, so a stored chip token reads as its chip. Absent = values as stored. */
  chips?: SheetChips | null
): SheetRead {
  const read: Record<string, string> = {};
  const unread: Record<string, string> = {};
  for (const [key, raw] of Object.entries(normalizeSetupData(data))) {
    const value = fmtSetupValue(raw);
    if (value) (isEngineerSetupKey(key) ? read : unread)[key] = chipLabel(value, chips?.[key]);
  }
  // Only boxes this sheet leaves unread take a driver's name: one the app reads keeps the app's.
  const named = Object.entries(names ?? {}).filter(([key, name]) => name.trim() && !(key in read));
  return named.length > 0 ? { read, unread, names: Object.fromEntries(named) } : { read, unread };
}

/** A box the driver named, as the blocks print it: `front roll bar (named by the driver)`. */
export function driverNamedLabel(name: string): string {
  return `${name.trim()} (named by the driver)`;
}

/** What "(named by the driver)" means — printed once in a block that shows one. */
export const DRIVER_NAMED_NOTE = `"(named by the driver)" is a box on a sheet the app cannot read yet that the driver has named themselves: what the box is comes from the driver.`;

/** The unread boxes the driver has named, as setup rows: `front roll bar (named by the driver): 1.4`. */
export function driverNamedRows(sheet: SheetRead): string[] {
  const names = sheet.names ?? {};
  return Object.entries(sheet.unread)
    .filter(([key]) => names[key])
    .map(([key, value]) => `${driverNamedLabel(names[key])}: ${value}`);
}

/** Filled boxes the app cannot read and the driver has not named — what "not shown here" counts. */
export function unnamedUnreadCount(sheet: SheetRead): number {
  const names = sheet.names ?? {};
  return Object.keys(sheet.unread).filter((key) => !names[key]).length;
}

/**
 * The Engineer can read too little of this sheet for what it reads to stand for the car. Until
 * 2026-09-24 such a sheet's "changed" line looked only at the boxes it could read — the gearing —
 * so a run where the springs and a bar moved printed "no setup change", and the founder's own
 * Bayside May–June, read as an X4 would be, said it 27 times where the truth was 2.
 */
export function sheetMostlyUnread(sheet: SheetRead): boolean {
  return Object.keys(sheet.read).length < MIN_READABLE_BOXES && Object.keys(sheet.unread).length > 0;
}

/**
 * The part of the sheet the app cannot read — one wording for the run block and the range block.
 * Founder, 2026-09-21: "a strong distinction between when the engineer can read a car and when it
 * can't". `filled` is how many boxes the driver has filled in.
 *
 * With nothing filled in, `car` says why (test drive, 2026-09-26): a driver with a setup saved on
 * the car had been told to fill in the sheet he already had, and one whose car has no sheet in the
 * app at all ("I don't have the sheet") was told the same. Absent, the wording is as before.
 */
export function notVisibleLines(
  filled: number,
  car: { savedSetups?: number; hasSheet?: boolean } = {}
): string[] {
  const saved = car.savedSetups ?? 0;
  const nothingFilled =
    saved > 0
      ? `No setup is attached to this run. The driver has ${saved} saved ${saved === 1 ? "setup" : "setups"} for this car and can pick one on the run: its values then appear here.`
      : car.hasSheet === false
        ? "This car has no setup sheet in the app, so none of its settings can be seen unless the driver says them."
        : "The driver has not filled in a setup sheet for this car. Once they do, the values the car ran appear here.";
  return [
    filled > 0
      ? `The driver filled in ${filled} boxes on this car's setup sheet, but the app has not yet learned which box is which on this chassis's sheet, so none of them can be read. That gap is the app's, not the driver's: they have already filled the sheet in.`
      : nothingFilled,
    "No setting on this car can be seen — not a spring, an oil, a toe, a camber or a ride height.",
  ];
}

/** The same, for a sheet read in part: the rows above it are all that can be seen. */
export function partlyVisibleLine(unread: number): string {
  return `The driver filled in ${unread} more ${unread === 1 ? "box" : "boxes"} on this car's setup sheet that the app cannot read yet: it has not learned which box is which on this chassis's sheet. That gap is the app's, not the driver's. Every setting not listed above is unknown — not absent, and not unchanged.`;
}

/**
 * Spur ÷ pinion, worked out here so the model never divides (north star: the arithmetic is done in
 * code). NOT the final drive ratio — that is this times the car's internal ratio, which no sheet
 * key reliably carries — and the line it prints says so. Null unless both are plain numbers.
 */
export function spurOverPinion(values: Record<string, string>): string | null {
  const spur = Number(values.spur ?? values.spur_gear ?? values.spurgear);
  const pinion = Number(values.pinion);
  if (!Number.isFinite(spur) || !Number.isFinite(pinion) || spur <= 0 || pinion <= 0) return null;
  return (spur / pinion).toFixed(3);
}

/**
 * Sheet keys that mean a lever exists under another name. A net's `parameter` is the canonical
 * key; sheets spell some knobs differently (droop is a downstop on an Awesomatix, flex is a C45
 * brace or a top-deck screw). Only ever used to AVOID saying a lever is missing.
 */
const LEVER_KEY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  droop_front: ["downstop_front"],
  droop_rear: ["downstop_rear"],
  top_deck_front: ["c45_installed_front", "top_deck", "topdeck"],
  top_deck_rear: ["c45_installed_rear", "top_deck", "topdeck"],
  top_deck_screws: ["top_deck", "topdeck", "motor_mount_screws", "c45_installed"],
  spring_front: ["front_spring", "front_shock_spring"],
  spring_rear: ["rear_spring", "rear_shock_spring"],
  shock_angle_front: ["shock_position_front", "front_shock_position", "front_shock_tower", "front_arm_shock", "shock_tower"],
  shock_angle_rear: ["shock_position_rear", "rear_shock_position", "rear_shock_tower", "rear_arm_shock", "shock_tower"],
  arb_front: ["front_anti_roll_bar", "front_arb", "front_roll_bar", "anti_roll_bar_front"],
  arb_rear: ["rear_anti_roll_bar", "rear_arb", "rear_roll_bar", "anti_roll_bar_rear"],
  damper_oil_front: ["front_shock_oil", "fr_shock_oil", "front_damper_oil"],
  damper_oil_rear: ["rear_shock_oil", "re_shock_oil", "rear_damper_oil"],
};

function sheetHasLever(parameter: string, sheetKeys: readonly string[]): boolean {
  const stems = [parameter, ...(LEVER_KEY_ALIASES[parameter] ?? [])];
  // `upper_inner_shims_front` is `upper_inner_shims_ff` + `_fr` on a sheet that splits the end.
  if (parameter.endsWith("_front")) stems.push(`${parameter.slice(0, -"_front".length)}_f`);
  if (parameter.endsWith("_rear")) stems.push(`${parameter.slice(0, -"_rear".length)}_r`);
  return sheetKeys.some((k) => stems.some((s) => k === s || k.startsWith(s)));
}

/**
 * The Engineer's levers this car's sheet has no box for — asked for five hairpin levers on an
 * A800RR, it offered "move the front shocks one hole more laid down" on a car with no shock holes
 * (round 04, 2026-09-19; founder 2026-09-21: only offer what is on the sheet).
 *
 * Deliberately timid, because a false "not on this car" takes a real lever away: it answers only
 * for a sheet the Engineer can already read (`minReadable` canonical keys), and gives up — returns
 * [] — when more than `maxMissing` levers look absent, which is what a sheet whose boxes are
 * spelled some other way looks like. Most of the 230 chassis in production are in that state, so
 * for most cars this says nothing, which is the honest answer.
 */
export function leversNotOnSheet(
  levers: ReadonlyArray<{ parameter: string; label: string }>,
  sheetKeys: readonly string[],
  opts: { minReadable?: number; maxMissing?: number } = {}
): string[] {
  const keys = [...new Set(sheetKeys.map((k) => k.trim().toLowerCase()).filter(Boolean))];
  if (keys.filter(isEngineerSetupKey).length < (opts.minReadable ?? MIN_READABLE_BOXES)) return [];
  const missing = levers.filter((l) => !sheetHasLever(l.parameter, keys)).map((l) => l.label);
  return missing.length > (opts.maxMissing ?? 6) ? [] : missing;
}

/**
 * Classes of car built around a rear pod. Owner's call on the 2026-09-26 test drive, after the
 * Engineer told a 1/12 pan-car racer her A12WC "can take a front sway bar" and led with rear toe-in:
 * a pan car (1/12 or 1/10) has no anti-roll bars and no rear toe or rear camber to adjust, because
 * its rear axle is solid, in a pod, and a formula car is built the same way. Only these: a false "no
 * such part" takes a real lever away, and the 1/8 pan car was not part of the call.
 */
const REAR_POD_CLASSES: Readonly<Record<string, string>> = {
  "pan-12th": "a pan car",
  "pan-10th": "a pan car",
  formula: "a formula car",
};

/**
 * The parts this car's class doesn't have, as the fact the run block states (driverData.ts), or null
 * for every other class and for a car nothing can place. `discipline` is `disciplineForCar`'s answer.
 */
export function partsTheClassLacks(discipline: string | null | undefined): string | null {
  const what = REAR_POD_CLASSES[parseDiscipline(discipline)?.classId ?? ""];
  if (!what) return null;
  return `THIS CAR HAS NO anti-roll bars, and no rear toe or rear camber to adjust: on ${what} the rear axle is solid, in a pod. What adjusts on it is the rear pod (side springs or links, the centre damper, droop), front toe, camber, caster and springs, ride height, the diff, and the tyres and their prep.`;
}

/** Tuning, body, gearing and motor keys only — the blob also carries tyres, battery, electronics and free text. */
export function tuningValues(data: unknown): Record<string, string> {
  return readSheet(data).read;
}

/**
 * `1` and `1.0`, or `STD` and `std`, are the same setting written twice — not a change the
 * driver made. Sheets store what was keyed, and canonicalising the box labels (2026-09-01)
 * recased a batch of preset values, so a naive string compare reports a day's worth of
 * changes nobody touched. Numbers compare as numbers, text ignores case and padding.
 */
export function sameSetupValue(a: string | undefined, b: string | undefined): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * What moved between two sheets. Null — not an empty list — when either side has no
 * readable setup: only a calibrated sheet gives values, and "nothing changed" and "we
 * cannot see the setup" are different facts (founder call 2026-09-01).
 */
export function diffTuning(
  prev: Record<string, string>,
  next: Record<string, string>
): string[] | null {
  if (Object.keys(prev).length === 0 || Object.keys(next).length === 0) return null;
  return listChanges(prev, next);
}

function listChanges(prev: Record<string, string>, next: Record<string, string>): string[] {
  const changes: string[] = [];
  for (const key of [...new Set([...Object.keys(prev), ...Object.keys(next)])].sort()) {
    if (sameSetupValue(prev[key], next[key])) continue;
    changes.push(`${readableSetupKey(key)} ${prev[key] ?? "—"} → ${next[key] ?? "—"}`);
  }
  return changes;
}

/**
 * What moved between two sheets, for a "changed" line: the boxes the Engineer reads, by name, and
 * `unread` — how many boxes it cannot read moved. Null when either sheet has nothing filled in.
 *
 * A box that is not a setting (`isSettingBox`: the tyres, the battery, the notes, who, when and
 * where) never counts: 27 of the 29 A800RR runs where only unread boxes moved were those, and
 * counting them would make the Engineer ask about every new set of tyres. Every other box that
 * moved counts, on any sheet, so "no setup change" is said only when no setting on the sheet moved.
 * Until 2026-09-26 a sheet the Engineer reads (20+ boxes) counted none at all: the Mi10 reads its
 * springs and geometry but not its castor or shock oil, and a change there printed "no setup change".
 */
export function diffSheet(
  prev: SheetRead,
  next: SheetRead
): { changes: string[]; unread: number; named?: number } | null {
  const filled = (s: SheetRead) => Object.keys(s.read).length + Object.keys(s.unread).length;
  if (filled(prev) === 0 || filled(next) === 0) return null;
  // A box the driver has named on this car is a change by that name; the rest are counted.
  const names = { ...(prev.names ?? {}), ...(next.names ?? {}) };
  let unread = 0;
  const named: string[] = [];
  for (const key of [...new Set([...Object.keys(prev.unread), ...Object.keys(next.unread)])].sort()) {
    if (!isSettingBox(key) || sameSetupValue(prev.unread[key], next.unread[key])) continue;
    if (names[key]) named.push(`${driverNamedLabel(names[key])} ${prev.unread[key] ?? "—"} → ${next.unread[key] ?? "—"}`);
    else unread++;
  }
  const changes = [...listChanges(prev.read, next.read), ...named];
  return named.length > 0 ? { changes, unread, named: named.length } : { changes, unread };
}

/**
 * "pinion 39 → 40, and 3 boxes not shown here" — null when nothing moved ("no setup change").
 *
 * `link` (sheetLinks.ts) turns the boxes into a Markdown link to them on the driver's own sheet:
 * "and [3 boxes not shown here](#sheet-4f9k2m)". Without one the words are exactly as before.
 */
export function changedWords(
  change: { changes: string[]; unread: number },
  maxListed: number,
  link?: string | null
): string | null {
  const { changes, unread } = change;
  if (changes.length === 0 && unread === 0) return null;
  const shown = changes.slice(0, maxListed).join(", ");
  const more = changes.length > maxListed ? `, +${changes.length - maxListed} more` : "";
  if (unread === 0) return `${shown}${more}`;
  const words = `${unread} ${unread === 1 ? "box" : "boxes"} not shown here`;
  const boxes = link ? `[${words}](#${link})` : words;
  return changes.length > 0 ? `${shown}${more}, and ${boxes}` : `only ${boxes}`;
}

/** The sentence a block adds when one of its "changed" lines counts boxes the Engineer cannot read. */
export const UNREAD_BOXES_NOTE = `"boxes not shown here" are boxes on a sheet the app cannot read yet: something in them moved, but not which setting or which way.`;

/**
 * The fact a block adds when those words are links (sheetLinks.ts). What to DO with a link is the
 * prompt's; this says only what one is.
 */
export const SHEET_LINKS_NOTE = `Each link on those words, (#sheet-…), opens the driver's own sheet with those boxes ringed, before and after, where the driver can say what each box is.`;
