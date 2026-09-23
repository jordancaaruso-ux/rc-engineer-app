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
  if (keys.filter(isEngineerSetupKey).length < (opts.minReadable ?? 20)) return [];
  const missing = levers.filter((l) => !sheetHasLever(l.parameter, keys)).map((l) => l.label);
  return missing.length > (opts.maxMissing ?? 6) ? [] : missing;
}

/** Tuning, body, gearing and motor keys only — the blob also carries tyres, battery, electronics and free text. */
export function tuningValues(data: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(normalizeSetupData(data))) {
    if (!isEngineerSetupKey(key)) continue;
    const value = fmtSetupValue(raw);
    if (value) out[key] = value;
  }
  return out;
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
  const changes: string[] = [];
  for (const key of [...new Set([...Object.keys(prev), ...Object.keys(next)])].sort()) {
    if (sameSetupValue(prev[key], next[key])) continue;
    changes.push(`${readableSetupKey(key)} ${prev[key] ?? "—"} → ${next[key] ?? "—"}`);
  }
  return changes;
}
