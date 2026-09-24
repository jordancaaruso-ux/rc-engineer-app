import { normalizeSetupData } from "@/lib/runSetup";
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

/** What the Engineer reads off a sheet: the tuning keys, the body, the gearing and the motor. */
export function isEngineerSetupKey(key: string): boolean {
  return isTuningComparisonKey(key) || ENGINEER_BODY_KEYS.has(key) || ENGINEER_DRIVETRAIN_KEYS.has(key);
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
 */
export type SheetRead = { read: Record<string, string>; unread: Record<string, string> };

export function readSheet(data: unknown): SheetRead {
  const read: Record<string, string> = {};
  const unread: Record<string, string> = {};
  for (const [key, raw] of Object.entries(normalizeSetupData(data))) {
    const value = fmtSetupValue(raw);
    if (value) (isEngineerSetupKey(key) ? read : unread)[key] = value;
  }
  return { read, unread };
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
 */
export function notVisibleLines(filled: number): string[] {
  return [
    filled > 0
      ? `The driver filled in ${filled} boxes on this car's setup sheet, but the app has not yet learned which box is which on this chassis's sheet, so none of them can be read. That gap is the app's, not the driver's: they have already filled the sheet in.`
      : "The driver has not filled in a setup sheet for this car. Once they do, the values the car ran appear here.",
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
  arb_front: ["front_anti_roll_bar", "front_arb", "front_roll_bar"],
  arb_rear: ["rear_anti_roll_bar", "rear_arb", "rear_roll_bar"],
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
 * On a sheet the Engineer reads, `unread` is always 0 and the line is `diffTuning`'s: there the
 * boxes it is not shown are the tyres, the battery and the notes (27 of the 29 A800RR runs where
 * only those moved), and counting them would make the Engineer ask about every new set of tyres.
 * On a sheet it can barely read (`sheetMostlyUnread`) every box counts, so "no setup change" is
 * said only when nothing on the sheet moved.
 */
export function diffSheet(prev: SheetRead, next: SheetRead): { changes: string[]; unread: number } | null {
  const filled = (s: SheetRead) => Object.keys(s.read).length + Object.keys(s.unread).length;
  if (filled(prev) === 0 || filled(next) === 0) return null;
  if (!sheetMostlyUnread(prev) && !sheetMostlyUnread(next)) {
    const changes = diffTuning(prev.read, next.read);
    return changes == null ? null : { changes, unread: 0 };
  }
  let unread = 0;
  for (const key of new Set([...Object.keys(prev.unread), ...Object.keys(next.unread)])) {
    if (!sameSetupValue(prev.unread[key], next.unread[key])) unread++;
  }
  return { changes: listChanges(prev.read, next.read), unread };
}

/** "pinion 39 → 40, and 3 boxes not shown here" — null when nothing moved ("no setup change"). */
export function changedWords(change: { changes: string[]; unread: number }, maxListed: number): string | null {
  const { changes, unread } = change;
  if (changes.length === 0 && unread === 0) return null;
  const shown = changes.slice(0, maxListed).join(", ");
  const more = changes.length > maxListed ? `, +${changes.length - maxListed} more` : "";
  if (unread === 0) return `${shown}${more}`;
  const boxes = `${unread} ${unread === 1 ? "box" : "boxes"} not shown here`;
  return changes.length > 0 ? `${shown}${more}, and ${boxes}` : `only ${boxes}`;
}

/** The sentence a block adds when one of its "changed" lines counts boxes the Engineer cannot read. */
export const UNREAD_BOXES_NOTE = `"boxes not shown here" are boxes on a sheet the app cannot read yet: something in them moved, but not which setting or which way.`;
