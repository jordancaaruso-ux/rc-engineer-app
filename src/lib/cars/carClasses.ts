/**
 * What a car races — the class it runs in AND what powers it (touring/electric, 1/8 buggy/nitro…).
 *
 * Why this exists: the log-run wizard's car-swap rule. Switching cars keeps the day context
 * (event/track/session/laps/notes always); tires + prep carry only between cars in the SAME
 * discipline (the same wheels bolt on), while a cross-discipline swap re-derives them from the new
 * car's own last run. Setup is always car-specific and swaps regardless. The teammate lap-compare
 * and `loadOutWithYou` scope the same way — a buggy lap in a touring list is a card nobody trusts
 * twice.
 *
 * How a car gets one — inference first, override second (`disciplineForCar` in
 * `chassisPlatform.ts` is the only correct way to ask):
 *
 *  1. The chassis catalog (`platformForChassisSlug`). Answers for every catalogued chassis and
 *     costs the driver nothing.
 *  2. `SetupSheetModel.discipline` — what the driver chose when they created the chassis from
 *     their own PDF. The chassis row is global, so one answer serves everyone who lands on it.
 *  3. `Car.carClass`, the per-car override, for a car the first two can't place.
 *
 * ## The list, and the shape of a stored answer (founder call, 2026-09-03)
 *
 * The old list was thirteen flat platforms with no notion of power, written when the app was
 * touring-only. It is now a full onroad/offroad class list, and **electric and nitro are different
 * disciplines**: a nitro 1/10 touring car and an electric one never share a heat, so they must
 * never share a comparison either.
 *
 * A stored answer is one string, so nothing in the schema had to change:
 *
 *     touring~electric              a known class and its power
 *     buggy-8th-4wd~nitro
 *     other-onroad~electric~Legends a class we don't list, named by the driver
 *     touring                       LEGACY: written before power was asked for
 *
 * Legacy bare ids still read and still compare — see `isSamePlatform`, which only lets power split
 * a class when BOTH sides state it. Nobody is made to re-answer a question they already answered.
 *
 * Racing class (17.5, Modified, …) is a *different* concept and already lives on the run/event as
 * `raceClass`; if it ever needs to drive behaviour it belongs there, not here.
 */

/** Where it races. Purely how the picker groups the classes — nothing branches on it. */
export type DisciplineSurface = "onroad" | "offroad";

export type PowerId = "electric" | "nitro";

export const POWER_TYPES: readonly { id: PowerId; label: string }[] = [
  { id: "electric", label: "Electric" },
  { id: "nitro", label: "Nitro" },
] as const;

export type RaceClass = {
  id: string;
  label: string;
  surface: DisciplineSurface;
  /** The two "Other" entries, which carry a name the driver types. */
  freeText?: boolean;
};

/**
 * The classes, in the founder's own order (2026-09-03) — the order they appear in the picker.
 *
 * Ids that survived the 2026-09-03 rewrite (`touring`, `formula`, `pan-12th`, `buggy-2wd`,
 * `buggy-4wd`, `short-course`, `stadium-truck`) keep their old spelling deliberately: rows already
 * carrying them stay placed. Retired ids live on in `LEGACY_CLASS_LABELS` so an old row still
 * renders as words rather than a slug.
 */
export const RACE_CLASSES: readonly RaceClass[] = [
  // Onroad
  { id: "touring", label: "1/10 Touring", surface: "onroad" },
  { id: "fwd", label: "1/10 Front Wheel", surface: "onroad" },
  { id: "pan-10th", label: "1/10 Pan Car", surface: "onroad" },
  { id: "pan-12th", label: "1/12 Pan Car", surface: "onroad" },
  { id: "gt-8th", label: "1/8 GT", surface: "onroad" },
  { id: "pan-8th", label: "1/8 Pan Car", surface: "onroad" },
  { id: "gt-5th", label: "1/5 GT", surface: "onroad" },
  { id: "formula", label: "Formula", surface: "onroad" },
  { id: "other-onroad", label: "Other", surface: "onroad", freeText: true },
  // Offroad
  { id: "buggy-2wd", label: "1/10 Buggy 2WD", surface: "offroad" },
  { id: "buggy-4wd", label: "1/10 Buggy 4WD", surface: "offroad" },
  { id: "truggy-10th", label: "1/10 Truggy", surface: "offroad" },
  { id: "short-course", label: "1/10 Short Course", surface: "offroad" },
  { id: "truggy-8th", label: "1/8 Truggy", surface: "offroad" },
  { id: "buggy-8th-2wd", label: "1/8 Buggy 2WD", surface: "offroad" },
  { id: "buggy-8th-4wd", label: "1/8 Buggy 4WD", surface: "offroad" },
  { id: "stadium-truck", label: "1/10 Stadium Truck", surface: "offroad" },
  { id: "other-offroad", label: "Other", surface: "offroad", freeText: true },
] as const;

export type RaceClassId = (typeof RACE_CLASSES)[number]["id"];

/**
 * Classes the picker no longer offers, kept only so a row written before 2026-09-03 still reads
 * as English. Never offered, never written — display only. `gt` and `buggy-8th` are deliberately
 * NOT remapped onto the new split ids (`gt-8th` / `buggy-8th-2wd`|`-4wd`): the old answer doesn't
 * say which, and guessing would put a car in a class its driver never chose.
 */
const LEGACY_CLASS_LABELS: Readonly<Record<string, string>> = {
  gt: "GT",
  "m-chassis": "M-chassis / mini",
  "buggy-8th": "1/8 Buggy",
  truggy: "Truggy",
  rally: "Rally",
  crawler: "Crawler / trail",
};

/** Field separator inside a stored answer. Stripped out of anything a driver types. */
const SEP = "~";

export type Discipline = {
  classId: string;
  /** Null on a legacy row written before power was part of the answer. */
  power: PowerId | null;
  /** Only ever set on an "Other" class: the name the driver typed. */
  otherLabel: string | null;
};

export function raceClass(classId: string | null | undefined): RaceClass | null {
  if (!classId) return null;
  return RACE_CLASSES.find((c) => c.id === classId) ?? null;
}

function isPowerId(value: string | null | undefined): value is PowerId {
  return value === "electric" || value === "nitro";
}

/** Take the `~` out of anything a driver typed, so it can never forge a field boundary. */
export function cleanOtherLabel(text: string | null | undefined): string {
  return (text ?? "").split(SEP).join(" ").replace(/\s+/g, " ").trim().slice(0, 60);
}

/** Read a stored answer. Returns null for blank/whitespace — "unset", not "unknown class". */
export function parseDiscipline(value: string | null | undefined): Discipline | null {
  const raw = value?.trim();
  if (!raw) return null;
  const parts = raw.split(SEP);
  const classId = parts[0]?.trim();
  if (!classId) return null;
  const power = parts[1]?.trim();
  return {
    classId,
    power: isPowerId(power) ? power : null,
    otherLabel: cleanOtherLabel(parts.slice(2).join(" ")) || null,
  };
}

/**
 * Build a stored answer, or `""` when the driver hasn't finished answering — an incomplete
 * discipline is never written, because a class with no power is exactly the half-answer this
 * rewrite exists to stop.
 */
export function formatDiscipline(input: {
  classId: string | null | undefined;
  power: PowerId | null | undefined;
  otherLabel?: string | null;
}): string {
  const cls = raceClass(input.classId?.trim());
  if (!cls || !isPowerId(input.power)) return "";
  if (!cls.freeText) return `${cls.id}${SEP}${input.power}`;
  const label = cleanOtherLabel(input.otherLabel);
  if (!label) return "";
  return `${cls.id}${SEP}${input.power}${SEP}${label}`;
}

/**
 * How an answer reads to a driver: "1/10 Touring · Electric", or "Legends · Nitro" for an
 * "Other". Echoes an unrecognised id back rather than refusing it — this is a display helper, and
 * a stored value it has never heard of should still render as something.
 */
export function disciplineLabel(value: string | null | undefined): string | null {
  const d = parseDiscipline(value);
  if (!d) return null;
  const cls = raceClass(d.classId);
  const name = cls?.freeText
    ? d.otherLabel || cls.label
    : cls?.label ?? LEGACY_CLASS_LABELS[d.classId] ?? d.classId;
  const power = POWER_TYPES.find((p) => p.id === d.power)?.label;
  return power ? `${name} · ${power}` : name;
}

/**
 * The gate on the way IN, so `SetupSheetModel.discipline` and `Car.carClass` can only ever hold an
 * answer the app can place. Strict: the class must be one we list, the power must be stated, and
 * an "Other" must carry the name the driver typed.
 *
 * `disciplineLabel` deliberately does the opposite and echoes an unknown id back — display and
 * validation are different jobs. Trim before calling; a padded value is not a value.
 */
export function isDisciplineValue(value: string | null | undefined): boolean {
  const d = parseDiscipline(value);
  if (!d || !d.power) return false;
  return formatDiscipline(d) === value?.trim();
}

/**
 * The lenient gate, for the founder's own doors (admin chassis creation,
 * `scripts/ingest-blank-sheets.ts`): the class must be real, but power may be left off. Blocking a
 * 40-file manifest on one missing word helps nobody, and he reviews those rows anyway.
 */
export function isKnownDisciplineClass(value: string | null | undefined): boolean {
  const raw = value?.trim();
  const d = parseDiscipline(raw);
  const cls = raceClass(d?.classId);
  if (!d || !cls) return false;
  // A bare class id and nothing else. Anything after it must be a WHOLE answer — "touring~petrol"
  // parses to a real class with an unreadable power, and letting that through would store a
  // half-answer that reads as a legacy row forever.
  if (raw === d.classId) return !cls.freeText;
  return isDisciplineValue(raw);
}

/** What two answers have to share to count as the same discipline. */
function classKey(d: Discipline): string {
  return raceClass(d.classId)?.freeText && d.otherLabel
    ? `${d.classId}${SEP}${d.otherLabel.toLowerCase()}`
    : d.classId;
}

/**
 * Same-discipline check for the car-swap rule and every "is this comparable" question.
 *
 * Unknown (null/blank) on either side counts as SAME — the safe default: a car nothing can place
 * keeps today's behaviour (tires carry, peer runs show) rather than silently re-deriving a
 * driver's tires mid-day or emptying a comparison list.
 *
 * **Power splits a class only when both sides state it** (2026-09-03). Electric and nitro are
 * different disciplines, but a row written before power was asked for doesn't say — and treating
 * its silence as "not nitro" would quietly un-compare cars that have been comparing for months.
 */
export function isSamePlatform(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const da = parseDiscipline(a);
  const db = parseDiscipline(b);
  if (!da || !db) return true;
  if (classKey(da) !== classKey(db)) return false;
  if (da.power && db.power && da.power !== db.power) return false;
  return true;
}
