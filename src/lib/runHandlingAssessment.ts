export type CornerPhase = "entry" | "mid" | "exit";

/** Legacy v1 JSON only; migrated on read. */
export type HandlingSeverity = "mild" | "moderate" | "severe";

export const HANDLING_SEVERITY_LABELS: Record<HandlingSeverity, string> = {
  mild: "mild",
  moderate: "moderate",
  severe: "severe",
};

/** 1 (light) … 5 (strong); used only when migrating old v1/v2 rows. */
export type HandlingIntensity1to5 = 1 | 2 | 3 | 4 | 5;

/** −3 = strong push, 0 = neutral, +3 = strong oversteer (per corner phase). Same range as feel vs last run. */
export type PhaseBalance = -3 | -2 | -1 | 0 | 1 | 2 | 3;

export type FeelVsLastRun = PhaseBalance;

/** Where a flagged handling issue shows up (corner speed). Orthogonal to corner phase. */
export type CornerSpeed = "slow" | "fast" | "both";

export const CORNER_SPEED_LABELS: Record<CornerSpeed, string> = {
  slow: "slow corners",
  fast: "fast corners",
  both: "everywhere",
};

/** Stable key identifying a flaggable handling issue a speed tag can attach to. */
export type HandlingIssueKey =
  | "balance:entry"
  | "balance:mid"
  | "balance:exit"
  | "trait:feelSteering"
  | "trait:onPower"
  | "trait:braking"
  | "trait:tractionRoll"
  | "trait:driveEase";

export type SpeedTagMap = Partial<Record<HandlingIssueKey, CornerSpeed>>;

function isCornerSpeed(v: unknown): v is CornerSpeed {
  return v === "slow" || v === "fast" || v === "both";
}

/** Five quick-pick values for required "vs last run" at Run complete. */
export const FEEL_VS_LAST_RUN_QUICK_OPTIONS = [
  { value: -3 as FeelVsLastRun, label: "Much worse" },
  { value: -2 as FeelVsLastRun, label: "Worse" },
  { value: 0 as FeelVsLastRun, label: "Similar" },
  { value: 2 as FeelVsLastRun, label: "Better" },
  { value: 3 as FeelVsLastRun, label: "Much better" },
] as const;

export function formatFeelVsLastRunQuickLabel(v: FeelVsLastRun): string {
  const match = FEEL_VS_LAST_RUN_QUICK_OPTIONS.find((o) => o.value === v);
  if (match) return match.label;
  if (v === -1) return "Worse";
  if (v === 1) return "Better";
  if (v === 0) return "Similar";
  const adv = adverbForMagnitude(v);
  const direction = v < 0 ? "worse" : "better";
  return `${adv ? `${adv} ` : ""}${direction}`.replace(/^\w/, (c) => c.toUpperCase());
}

export function coerceFeelVsLastRunForCompleteRun(
  raw: unknown,
  hasPriorRunOnCar: boolean
): { parsed: RunHandlingAssessmentParsed | null; error?: string } {
  const parsed = parseHandlingAssessmentJson(raw);
  const feel = parsed?.feelVsLastRun ?? null;

  // The "feel vs last run" quick-pick was retired from the complete flow, so
  // completion is never blocked on it. When it's absent and there's no prior
  // run to compare against, seed a neutral 0; otherwise pass through untouched.
  if (!hasPriorRunOnCar && feel == null) {
    if (!parsed) return { parsed: { version: 6, feelVsLastRun: 0 } };
    return { parsed: { ...parsed, feelVsLastRun: 0 } };
  }

  return { parsed };
}

export type BalanceByPhaseMap = {
  entry?: PhaseBalance;
  mid?: PhaseBalance;
  exit?: PhaseBalance;
};

/**
 * Labels for the −3…+3 handling trait rows. Since 2026-07-08 traits are captured as
 * flag-if-notable chips (see `HANDLING_TRAIT_CHIP_META`), but storage stays signed
 * −3…+3 so the Engineer read is unchanged. `feelGeneral` is retired from capture
 * (kept here only to label legacy runs).
 */
export const HANDLING_TRAIT_AXIS_UI = {
  feelSteering: { title: "Steering feel", neg: "Dull", pos: "Pointy" },
  onPower: { title: "On-power", neg: "Snaps", pos: "Hooks up" },
  braking: { title: "Braking", neg: "Loose", pos: "Stable" },
  tractionRoll: { title: "Traction rolling", neg: "Never", pos: "Often" },
  driveEase: { title: "Drivability", neg: "On edge", pos: "Easy" },
  /** @deprecated Retired from capture 2026-07-08; kept to label legacy stored runs. */
  feelGeneral: { title: "General feel", neg: "Smooth", pos: "Reactive" },
} as const;

export type HandlingTraitAxisKey = keyof typeof HANDLING_TRAIT_AXIS_UI;

/** Trait keys offered in the current capture UI (retired `feelGeneral` excluded). */
export const CAPTURE_TRAIT_AXIS_KEYS = [
  "feelSteering",
  "onPower",
  "braking",
  "tractionRoll",
  "driveEase",
] as const;

export type CaptureTraitAxisKey = (typeof CAPTURE_TRAIT_AXIS_KEYS)[number];

/**
 * Flag-if-notable chip metadata. Each chip flags a *problem* pole; the good state is the
 * absence of a flag. `sign` is the direction the stored −3…+3 value takes when flagged;
 * severity (1/2/3 = mild/moderate/severe) supplies the magnitude. Steering feel is the
 * only genuinely bipolar chip (both poles are real problems).
 */
export const HANDLING_TRAIT_CHIP_META: Record<
  CaptureTraitAxisKey,
  { title: string; problemPoles: Array<{ sign: -1 | 1; label: string }> }
> = {
  feelSteering: {
    title: "Steering feel",
    problemPoles: [
      { sign: -1, label: "Too dull" },
      { sign: 1, label: "Too darty" },
    ],
  },
  onPower: { title: "On-power", problemPoles: [{ sign: -1, label: "Snaps on power" }] },
  braking: { title: "Braking", problemPoles: [{ sign: -1, label: "Loose on brakes" }] },
  tractionRoll: { title: "Traction rolling", problemPoles: [{ sign: 1, label: "Traction rolled" }] },
  driveEase: { title: "Drivability", problemPoles: [{ sign: -1, label: "Hard to drive" }] },
} as const;

export const HANDLING_SEVERITY_CHIP_LABELS: Record<1 | 2 | 3, string> = {
  1: "mild",
  2: "moderate",
  3: "severe",
};

/** Legacy v4 string presets — kept for migrating stored JSON only. */
const STEERING_FEEL_PRESETS = ["pointy", "dull", "nervous", "neutral", "direct", "vague"] as const;
type SteeringFeelPreset = (typeof STEERING_FEEL_PRESETS)[number];

const GENERAL_FEEL_PRESETS = ["smooth", "plush", "aggressive", "sharp"] as const;
type GeneralFeelPreset = (typeof GENERAL_FEEL_PRESETS)[number];

const DRIVE_DIFFICULTY_PRESETS = ["easy", "hard"] as const;
type DriveDifficultyPreset = (typeof DRIVE_DIFFICULTY_PRESETS)[number];

const SINGLE_TRAIT_IDS = ["traction_roll", "on_power_snaps", "rear_grip_limit"] as const;
type SingleTraitTagId = (typeof SINGLE_TRAIT_IDS)[number];

const DOES_WELL_IDS = [
  "predictable_limit",
  "good_rotation",
  "stable_on_throttle",
  "confident_braking",
  "easy_to_place",
] as const;
type DoesWellPresetId = (typeof DOES_WELL_IDS)[number];

/** Which dimension is the primary focus (must match a selection already made). */
export type PrimaryFocus =
  | { kind: "balance"; phase: CornerPhase; value: PhaseBalance }
  | { kind: "feel_vs_last"; value: FeelVsLastRun }
  | { kind: "feel_steering"; value: PhaseBalance }
  | { kind: "feel_general"; value: PhaseBalance }
  | { kind: "on_power"; value: PhaseBalance }
  | { kind: "braking"; value: PhaseBalance }
  | { kind: "drive_ease"; value: PhaseBalance }
  | { kind: "traction_roll"; value: PhaseBalance };

/** Persisted JSON (current). Traits stored signed −3…+3 even though captured as chips. */
export type RunHandlingAssessmentParsed = {
  version: 6;
  balanceByPhase?: BalanceByPhaseMap;
  feelVsLastRun?: FeelVsLastRun;
  /** −3 dull … +3 pointy */
  feelSteering?: PhaseBalance;
  /** −3 snaps … +3 hooks up (problem pole is negative) */
  onPower?: PhaseBalance;
  /** −3 loose … +3 stable (problem pole is negative) */
  braking?: PhaseBalance;
  /** −3 never … +3 often (problem pole is positive) */
  tractionRoll?: PhaseBalance;
  /** −3 on-edge/hard … +3 easy (problem pole is negative) */
  driveEase?: PhaseBalance;
  /** @deprecated retired from capture 2026-07-08; still read from legacy rows. −3 smooth … +3 reactive */
  feelGeneral?: PhaseBalance;
  /** Optional slow/fast/both tag per flagged issue (balance phase or trait). */
  speedTags?: SpeedTagMap;
  primaryFocus?: PrimaryFocus;
};

/** @deprecated Legacy v1 trait ids (stored on old JSON only). */
export const LEGACY_TRAIT_TAG_IDS = [
  "nervous",
  "pointy",
  "darty",
  "prone_to_flipping",
  "hard_on_kerbs",
] as const;
export type LegacyHandlingTraitTagId = (typeof LEGACY_TRAIT_TAG_IDS)[number];

/** @deprecated Legacy rows. */
export type RunHandlingAssessmentV1 = {
  version: 1;
  understeer?: { entry?: boolean; mid?: boolean; exit?: boolean };
  oversteer?: { entry?: boolean; mid?: boolean; exit?: boolean };
  understeerSeverity?: HandlingSeverity;
  oversteerSeverity?: HandlingSeverity;
  traitTags?: LegacyHandlingTraitTagId[];
  traitsOther?: string | null;
  mainProblem?: string | null;
  carDoesWell?: string | null;
};

/** @deprecated v2 dual-axis balance; migrated on read. */
export type RunHandlingAssessmentV2 = {
  version: 2;
  understeer?: { entry?: boolean; mid?: boolean; exit?: boolean };
  oversteer?: { entry?: boolean; mid?: boolean; exit?: boolean };
  understeerIntensity?: HandlingIntensity1to5;
  oversteerIntensity?: HandlingIntensity1to5;
  feelVsLastRun?: FeelVsLastRun;
  traitTags?: LegacyHandlingTraitTagId[];
  traitsOther?: string | null;
  mainProblem?: string | null;
  carDoesWell?: string | null;
};

const PHASES: CornerPhase[] = ["entry", "mid", "exit"];

function isLegacySeverity(s: string): s is HandlingSeverity {
  return s === "mild" || s === "moderate" || s === "severe";
}

function legacySeverityToIntensity(s: HandlingSeverity): HandlingIntensity1to5 {
  if (s === "mild") return 2;
  if (s === "moderate") return 3;
  return 5;
}

function isIntensity1to5(n: unknown): n is HandlingIntensity1to5 {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5;
}

/** Magnitude on the −3…+3 chip scale: |1| mild, |2| moderate, |3| severe. */
export function phaseBalanceMagnitudeWord(v: PhaseBalance): string | null {
  const a = Math.abs(v);
  if (a === 1) return "mild";
  if (a === 2) return "moderate";
  if (a === 3) return "severe";
  return null;
}

function isPhaseBalance(n: unknown): n is PhaseBalance {
  return typeof n === "number" && Number.isInteger(n) && n >= -3 && n <= 3;
}

function normalizePhaseBlock(
  raw: unknown
): { entry?: boolean; mid?: boolean; exit?: boolean } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const out: { entry?: boolean; mid?: boolean; exit?: boolean } = {};
  for (const p of PHASES) {
    if (o[p] === true) out[p] = true;
  }
  return Object.keys(out).length ? out : undefined;
}

function legacyIntensityToMagnitude(i: HandlingIntensity1to5): 1 | 2 | 3 {
  const m = Math.min(3, Math.max(1, Math.round((i * 3) / 5)));
  return m as 1 | 2 | 3;
}

function mergeLegacyUsOsForPhase(
  us: boolean | undefined,
  os: boolean | undefined,
  ui: HandlingIntensity1to5,
  oi: HandlingIntensity1to5
): PhaseBalance | null {
  if (!us && !os) return null;
  const magUs = legacyIntensityToMagnitude(ui);
  const magOs = legacyIntensityToMagnitude(oi);
  if (us && !os) return (-magUs) as PhaseBalance;
  if (!us && os) return magOs as PhaseBalance;
  if (us && os) {
    if (magOs > magUs) return magOs as PhaseBalance;
    if (magUs > magOs) return (-magUs) as PhaseBalance;
    return 0;
  }
  return null;
}

type V3Like = {
  balanceByPhase?: BalanceByPhaseMap;
  feelVsLastRun?: FeelVsLastRun;
  traitTags?: string[];
  traitsOther?: string;
  mainProblem?: string;
  carDoesWell?: string;
};

function isSteeringFeelPreset(s: string): s is SteeringFeelPreset {
  return (STEERING_FEEL_PRESETS as readonly string[]).includes(s);
}

function isGeneralFeelPreset(s: string): s is GeneralFeelPreset {
  return (GENERAL_FEEL_PRESETS as readonly string[]).includes(s);
}

function isDriveDifficultyPreset(s: string): s is DriveDifficultyPreset {
  return (DRIVE_DIFFICULTY_PRESETS as readonly string[]).includes(s);
}

function isSingleTraitTagId(s: string): s is SingleTraitTagId {
  return (SINGLE_TRAIT_IDS as readonly string[]).includes(s);
}

function isDoesWellId(s: string): s is DoesWellPresetId {
  return (DOES_WELL_IDS as readonly string[]).includes(s);
}

function inferSteeringFromLegacyTags(tags: string[] | undefined): SteeringFeelPreset | undefined {
  if (!tags?.length) return undefined;
  if (tags.includes("pointy")) return "pointy";
  if (tags.includes("nervous")) return "nervous";
  if (tags.includes("darty")) return "vague";
  return undefined;
}

function legacyTagsToSingleTraits(tags: string[] | undefined): SingleTraitTagId[] {
  if (!tags?.length) return [];
  const out: SingleTraitTagId[] = [];
  if (tags.includes("prone_to_flipping")) out.push("traction_roll");
  if (tags.includes("hard_on_kerbs")) out.push("rear_grip_limit");
  return out;
}

type HandlingAssessmentV4Fields = {
  balanceByPhase?: BalanceByPhaseMap;
  feelVsLastRun?: FeelVsLastRun;
  steeringFeel?: SteeringFeelPreset;
  generalFeel?: GeneralFeelPreset;
  driveDifficulty?: DriveDifficultyPreset;
  singleTraits?: SingleTraitTagId[];
  doesWell?: DoesWellPresetId[];
  primaryFocusRaw?: unknown;
};

function mapSteeringPresetToAxis(p: SteeringFeelPreset): PhaseBalance {
  const m: Record<SteeringFeelPreset, PhaseBalance> = {
    dull: -3,
    vague: -2,
    neutral: 0,
    direct: 2,
    pointy: 3,
    nervous: 3,
  };
  return m[p];
}

function mapGeneralPresetToAxis(p: GeneralFeelPreset): PhaseBalance {
  const m: Record<GeneralFeelPreset, PhaseBalance> = {
    smooth: -3,
    plush: -2,
    aggressive: 2,
    sharp: 3,
  };
  return m[p];
}

function mapDriveDifficultyPresetToAxis(p: DriveDifficultyPreset): PhaseBalance {
  return p === "hard" ? -3 : 3;
}

function v4FieldsHasAnyContent(f: HandlingAssessmentV4Fields): boolean {
  return (
    Boolean(
      f.balanceByPhase &&
        (f.balanceByPhase.entry != null ||
          f.balanceByPhase.mid != null ||
          f.balanceByPhase.exit != null)
    ) ||
    f.feelVsLastRun != null ||
    f.steeringFeel != null ||
    f.generalFeel != null ||
    f.driveDifficulty != null ||
    (f.singleTraits != null && f.singleTraits.length > 0) ||
    (f.doesWell != null && f.doesWell.length > 0) ||
    f.primaryFocusRaw != null
  );
}

function v5HasAnyContent(t: RunHandlingAssessmentParsed): boolean {
  return (
    Boolean(
      t.balanceByPhase &&
        (t.balanceByPhase.entry != null ||
          t.balanceByPhase.mid != null ||
          t.balanceByPhase.exit != null)
    ) ||
    t.feelVsLastRun != null ||
    t.feelSteering != null ||
    t.onPower != null ||
    t.braking != null ||
    t.feelGeneral != null ||
    t.driveEase != null ||
    t.tractionRoll != null ||
    t.primaryFocus != null
  );
}

function finalizeV5(t: RunHandlingAssessmentParsed): RunHandlingAssessmentParsed | null {
  return v5HasAnyContent(t) ? t : null;
}

/** Prune speed tags whose underlying issue is not actually set. */
function pruneSpeedTags(t: RunHandlingAssessmentParsed): void {
  if (!t.speedTags) return;
  const kept: SpeedTagMap = {};
  for (const [key, speed] of Object.entries(t.speedTags)) {
    if (!isCornerSpeed(speed)) continue;
    if (handlingIssueIsSet(t, key as HandlingIssueKey)) kept[key as HandlingIssueKey] = speed;
  }
  if (Object.keys(kept).length) t.speedTags = kept;
  else delete t.speedTags;
}

function handlingIssueIsSet(t: RunHandlingAssessmentParsed, key: HandlingIssueKey): boolean {
  switch (key) {
    case "balance:entry":
      return t.balanceByPhase?.entry != null;
    case "balance:mid":
      return t.balanceByPhase?.mid != null;
    case "balance:exit":
      return t.balanceByPhase?.exit != null;
    case "trait:feelSteering":
      return t.feelSteering != null;
    case "trait:onPower":
      return t.onPower != null;
    case "trait:braking":
      return t.braking != null;
    case "trait:tractionRoll":
      return t.tractionRoll != null;
    case "trait:driveEase":
      return t.driveEase != null;
    default:
      return false;
  }
}

function parsePrimaryFocusLegacy(raw: unknown): LegacyV4PrimaryFocus | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const kind = o.kind;
  if (kind === "balance" && typeof o.phase === "string" && PHASES.includes(o.phase as CornerPhase)) {
    const v = o.value;
    if (isPhaseBalance(v)) return { kind: "balance", phase: o.phase as CornerPhase, value: v };
  }
  if (kind === "feel_vs_last") {
    const v = o.value;
    if (isPhaseBalance(v)) return { kind: "feel_vs_last", value: v };
  }
  if (kind === "steering_feel" && typeof o.value === "string" && isSteeringFeelPreset(o.value)) {
    return { kind: "steering_feel", value: o.value };
  }
  if (kind === "general_feel" && typeof o.value === "string" && isGeneralFeelPreset(o.value)) {
    return { kind: "general_feel", value: o.value };
  }
  if (kind === "drive_difficulty" && typeof o.value === "string" && isDriveDifficultyPreset(o.value)) {
    return { kind: "drive_difficulty", value: o.value };
  }
  if (kind === "single_trait" && typeof o.value === "string" && isSingleTraitTagId(o.value)) {
    return { kind: "single_trait", value: o.value };
  }
  if (kind === "does_well" && typeof o.value === "string" && isDoesWellId(o.value)) {
    return { kind: "does_well", value: o.value };
  }
  return undefined;
}

/** v4 primaryFocus JSON shapes. */
type LegacyV4PrimaryFocus =
  | { kind: "balance"; phase: CornerPhase; value: PhaseBalance }
  | { kind: "feel_vs_last"; value: FeelVsLastRun }
  | { kind: "steering_feel"; value: SteeringFeelPreset }
  | { kind: "general_feel"; value: GeneralFeelPreset }
  | { kind: "drive_difficulty"; value: DriveDifficultyPreset }
  | { kind: "single_trait"; value: SingleTraitTagId }
  | { kind: "does_well"; value: DoesWellPresetId };

function migrateLegacyPrimaryFocusToV5(raw: unknown): PrimaryFocus | undefined {
  const pf = parsePrimaryFocusLegacy(raw);
  if (!pf) return parsePrimaryFocusV5(raw);
  if (pf.kind === "balance" || pf.kind === "feel_vs_last") return pf;
  if (pf.kind === "steering_feel") {
    return { kind: "feel_steering", value: mapSteeringPresetToAxis(pf.value) };
  }
  if (pf.kind === "general_feel") {
    return { kind: "feel_general", value: mapGeneralPresetToAxis(pf.value) };
  }
  if (pf.kind === "drive_difficulty") {
    return { kind: "drive_ease", value: mapDriveDifficultyPresetToAxis(pf.value) };
  }
  if (pf.kind === "single_trait") {
    if (pf.value === "traction_roll") return { kind: "traction_roll", value: 2 };
    return undefined;
  }
  return undefined;
}

function parsePrimaryFocusV5(raw: unknown): PrimaryFocus | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const kind = o.kind;
  if (kind === "balance" && typeof o.phase === "string" && PHASES.includes(o.phase as CornerPhase)) {
    const v = o.value;
    if (isPhaseBalance(v)) return { kind: "balance", phase: o.phase as CornerPhase, value: v };
  }
  if (kind === "feel_vs_last") {
    const v = o.value;
    if (isPhaseBalance(v)) return { kind: "feel_vs_last", value: v };
  }
  if (kind === "feel_steering") {
    const v = o.value;
    if (isPhaseBalance(v)) return { kind: "feel_steering", value: v };
  }
  if (kind === "feel_general") {
    const v = o.value;
    if (isPhaseBalance(v)) return { kind: "feel_general", value: v };
  }
  if (kind === "on_power") {
    const v = o.value;
    if (isPhaseBalance(v)) return { kind: "on_power", value: v };
  }
  if (kind === "braking") {
    const v = o.value;
    if (isPhaseBalance(v)) return { kind: "braking", value: v };
  }
  if (kind === "drive_ease") {
    const v = o.value;
    if (isPhaseBalance(v)) return { kind: "drive_ease", value: v };
  }
  if (kind === "traction_roll") {
    const v = o.value;
    if (isPhaseBalance(v)) return { kind: "traction_roll", value: v };
  }
  return undefined;
}

function primaryFocusMatchesParsed(pf: PrimaryFocus, parsed: RunHandlingAssessmentParsed): boolean {
  const b = parsed.balanceByPhase;
  switch (pf.kind) {
    case "balance": {
      const v = pf.phase === "entry" ? b?.entry : pf.phase === "mid" ? b?.mid : b?.exit;
      return v === pf.value;
    }
    case "feel_vs_last":
      return parsed.feelVsLastRun === pf.value;
    case "feel_steering":
      return parsed.feelSteering === pf.value;
    case "feel_general":
      return parsed.feelGeneral === pf.value;
    case "on_power":
      return parsed.onPower === pf.value;
    case "braking":
      return parsed.braking === pf.value;
    case "drive_ease":
      return parsed.driveEase === pf.value;
    case "traction_roll":
      return parsed.tractionRoll === pf.value;
    default:
      return false;
  }
}

function migrateV4FieldsToV5(f: HandlingAssessmentV4Fields): RunHandlingAssessmentParsed | null {
  const out: RunHandlingAssessmentParsed = { version: 6 };
  if (f.balanceByPhase && Object.keys(f.balanceByPhase).length) {
    out.balanceByPhase = { ...f.balanceByPhase };
  }
  if (f.feelVsLastRun != null && isPhaseBalance(f.feelVsLastRun)) {
    out.feelVsLastRun = f.feelVsLastRun;
  }
  if (f.steeringFeel) out.feelSteering = mapSteeringPresetToAxis(f.steeringFeel);
  if (f.generalFeel) out.feelGeneral = mapGeneralPresetToAxis(f.generalFeel);
  if (f.driveDifficulty) out.driveEase = mapDriveDifficultyPresetToAxis(f.driveDifficulty);
  if (f.singleTraits?.includes("traction_roll")) {
    const fromTag = 2 as PhaseBalance;
    out.tractionRoll =
      out.tractionRoll != null ? (Math.max(out.tractionRoll, fromTag) as PhaseBalance) : fromTag;
  }
  const migratedFocus = migrateLegacyPrimaryFocusToV5(f.primaryFocusRaw);
  if (migratedFocus) {
    if (primaryFocusMatchesParsed(migratedFocus, out)) out.primaryFocus = migratedFocus;
  }
  return finalizeV5(out);
}

function migrateV3LikeToV4Fields(v3: V3Like): HandlingAssessmentV4Fields | null {
  const out: HandlingAssessmentV4Fields = {};
  if (v3.balanceByPhase && Object.keys(v3.balanceByPhase).length) {
    out.balanceByPhase = { ...v3.balanceByPhase };
  }
  if (v3.feelVsLastRun != null && isPhaseBalance(v3.feelVsLastRun)) {
    out.feelVsLastRun = v3.feelVsLastRun;
  }
  const steer = inferSteeringFromLegacyTags(v3.traitTags);
  if (steer) out.steeringFeel = steer;
  const singles = legacyTagsToSingleTraits(v3.traitTags);
  if (singles.length) out.singleTraits = singles;
  return v4FieldsHasAnyContent(out) ? out : null;
}

function attachLegacyCommonToV3Like(out: V3Like, o: Record<string, unknown>): void {
  if (Array.isArray(o.traitTags)) {
    const tags = o.traitTags.filter((t): t is string => typeof t === "string" && t.length > 0) as string[];
    if (tags.length) out.traitTags = tags;
  }
  if (typeof o.traitsOther === "string" && o.traitsOther.trim()) out.traitsOther = o.traitsOther.trim();
  if (typeof o.mainProblem === "string" && o.mainProblem.trim()) out.mainProblem = o.mainProblem.trim();
  if (typeof o.carDoesWell === "string" && o.carDoesWell.trim()) out.carDoesWell = o.carDoesWell.trim();
}

function migrateV1ToV4(o: Record<string, unknown>): RunHandlingAssessmentParsed | null {
  const understeer = normalizePhaseBlock(o.understeer);
  const oversteer = normalizePhaseBlock(o.oversteer);
  const ui =
    typeof o.understeerSeverity === "string" && isLegacySeverity(o.understeerSeverity)
      ? legacySeverityToIntensity(o.understeerSeverity)
      : 3;
  const oi =
    typeof o.oversteerSeverity === "string" && isLegacySeverity(o.oversteerSeverity)
      ? legacySeverityToIntensity(o.oversteerSeverity)
      : 3;

  const balanceByPhase: BalanceByPhaseMap = {};
  for (const p of PHASES) {
    const b = mergeLegacyUsOsForPhase(understeer?.[p], oversteer?.[p], ui, oi);
    if (b !== null) balanceByPhase[p] = b;
  }

  const v3: V3Like = {};
  if (Object.keys(balanceByPhase).length) v3.balanceByPhase = balanceByPhase;
  attachLegacyCommonToV3Like(v3, o);
  const fields = migrateV3LikeToV4Fields(v3);
  return fields ? migrateV4FieldsToV5(fields) : null;
}

function migrateV2ToV4(o: Record<string, unknown>): RunHandlingAssessmentParsed | null {
  const understeer = normalizePhaseBlock(o.understeer);
  const oversteer = normalizePhaseBlock(o.oversteer);
  const ui =
    o.understeerIntensity != null && isIntensity1to5(o.understeerIntensity) ? o.understeerIntensity : 3;
  const oi =
    o.oversteerIntensity != null && isIntensity1to5(o.oversteerIntensity) ? o.oversteerIntensity : 3;

  const balanceByPhase: BalanceByPhaseMap = {};
  for (const p of PHASES) {
    const b = mergeLegacyUsOsForPhase(understeer?.[p], oversteer?.[p], ui, oi);
    if (b !== null) balanceByPhase[p] = b;
  }

  const v3: V3Like = {};
  if (Object.keys(balanceByPhase).length) v3.balanceByPhase = balanceByPhase;
  if (o.feelVsLastRun != null && isPhaseBalance(o.feelVsLastRun)) v3.feelVsLastRun = o.feelVsLastRun;
  attachLegacyCommonToV3Like(v3, o);
  const fields = migrateV3LikeToV4Fields(v3);
  return fields ? migrateV4FieldsToV5(fields) : null;
}

function parseV4Raw(o: Record<string, unknown>): RunHandlingAssessmentParsed | null {
  const bb = o.balanceByPhase;
  const balanceByPhase: BalanceByPhaseMap = {};
  if (bb && typeof bb === "object" && !Array.isArray(bb)) {
    const r = bb as Record<string, unknown>;
    for (const p of PHASES) {
      const v = r[p];
      if (v != null && isPhaseBalance(v)) balanceByPhase[p] = v;
    }
  }
  const fvl = o.feelVsLastRun != null && isPhaseBalance(o.feelVsLastRun) ? o.feelVsLastRun : undefined;
  const steeringFeel =
    typeof o.steeringFeel === "string" && isSteeringFeelPreset(o.steeringFeel) ? o.steeringFeel : undefined;
  const generalFeel =
    typeof o.generalFeel === "string" && isGeneralFeelPreset(o.generalFeel) ? o.generalFeel : undefined;
  const driveDifficulty =
    typeof o.driveDifficulty === "string" && isDriveDifficultyPreset(o.driveDifficulty)
      ? o.driveDifficulty
      : undefined;
  let singleTraits: SingleTraitTagId[] | undefined;
  if (Array.isArray(o.singleTraits)) {
    const st = o.singleTraits.filter((t): t is SingleTraitTagId => typeof t === "string" && isSingleTraitTagId(t));
    if (st.length) singleTraits = st;
  }
  let doesWell: DoesWellPresetId[] | undefined;
  if (Array.isArray(o.doesWell)) {
    const dw = o.doesWell.filter((t): t is DoesWellPresetId => typeof t === "string" && isDoesWellId(t));
    if (dw.length) doesWell = dw;
  }
  const fields: HandlingAssessmentV4Fields = {};
  if (Object.keys(balanceByPhase).length) fields.balanceByPhase = balanceByPhase;
  if (fvl !== undefined) fields.feelVsLastRun = fvl;
  if (steeringFeel) fields.steeringFeel = steeringFeel;
  if (generalFeel) fields.generalFeel = generalFeel;
  if (driveDifficulty) fields.driveDifficulty = driveDifficulty;
  if (singleTraits) fields.singleTraits = singleTraits;
  if (doesWell) fields.doesWell = doesWell;
  if (o.primaryFocus != null) fields.primaryFocusRaw = o.primaryFocus;
  return migrateV4FieldsToV5(fields);
}

/** Reads both v5 and v6 raw JSON (v5 simply lacks the newer keys). Output is always v6. */
function parseV5OrV6Raw(o: Record<string, unknown>): RunHandlingAssessmentParsed | null {
  const bb = o.balanceByPhase;
  const balanceByPhase: BalanceByPhaseMap = {};
  if (bb && typeof bb === "object" && !Array.isArray(bb)) {
    const r = bb as Record<string, unknown>;
    for (const p of PHASES) {
      const v = r[p];
      if (v != null && isPhaseBalance(v)) balanceByPhase[p] = v;
    }
  }
  const fvl = o.feelVsLastRun != null && isPhaseBalance(o.feelVsLastRun) ? o.feelVsLastRun : undefined;
  const out: RunHandlingAssessmentParsed = { version: 6 };
  if (Object.keys(balanceByPhase).length) out.balanceByPhase = balanceByPhase;
  if (fvl !== undefined) out.feelVsLastRun = fvl;
  for (const key of [
    "feelSteering",
    "onPower",
    "braking",
    "tractionRoll",
    "driveEase",
    "feelGeneral",
  ] as const) {
    const v = o[key];
    if (v != null && isPhaseBalance(v)) out[key] = v;
  }
  const st = o.speedTags;
  if (st && typeof st === "object" && !Array.isArray(st)) {
    const tags: SpeedTagMap = {};
    for (const [key, speed] of Object.entries(st as Record<string, unknown>)) {
      if (isCornerSpeed(speed)) tags[key as HandlingIssueKey] = speed;
    }
    if (Object.keys(tags).length) out.speedTags = tags;
  }
  const pf = parsePrimaryFocusV5(o.primaryFocus) ?? migrateLegacyPrimaryFocusToV5(o.primaryFocus);
  if (pf != null && primaryFocusMatchesParsed(pf, out)) out.primaryFocus = pf;
  pruneSpeedTags(out);
  return finalizeV5(out);
}

function parseV3Raw(o: Record<string, unknown>): RunHandlingAssessmentParsed | null {
  const bb = o.balanceByPhase;
  const balanceByPhase: BalanceByPhaseMap = {};
  if (bb && typeof bb === "object" && !Array.isArray(bb)) {
    const r = bb as Record<string, unknown>;
    for (const p of PHASES) {
      const v = r[p];
      if (v != null && isPhaseBalance(v)) balanceByPhase[p] = v;
    }
  }
  const fvl = o.feelVsLastRun != null && isPhaseBalance(o.feelVsLastRun) ? o.feelVsLastRun : undefined;

  let traitTags: string[] | undefined;
  if (Array.isArray(o.traitTags)) {
    const tags = o.traitTags.filter((t): t is string => typeof t === "string" && t.length > 0);
    if (tags.length) traitTags = tags;
  }
  const traitsOther =
    typeof o.traitsOther === "string" && o.traitsOther.trim() ? o.traitsOther.trim() : undefined;
  const mainProblem =
    typeof o.mainProblem === "string" && o.mainProblem.trim() ? o.mainProblem.trim() : undefined;
  const carDoesWell =
    typeof o.carDoesWell === "string" && o.carDoesWell.trim() ? o.carDoesWell.trim() : undefined;

  const v3: V3Like = {};
  if (Object.keys(balanceByPhase).length) v3.balanceByPhase = balanceByPhase;
  if (fvl !== undefined) v3.feelVsLastRun = fvl;
  if (traitTags) v3.traitTags = traitTags;
  if (traitsOther) v3.traitsOther = traitsOther;
  if (mainProblem) v3.mainProblem = mainProblem;
  if (carDoesWell) v3.carDoesWell = carDoesWell;

  if (
    !v3.balanceByPhase &&
    v3.feelVsLastRun === undefined &&
    !v3.traitTags &&
    !v3.traitsOther &&
    !v3.mainProblem &&
    !v3.carDoesWell
  ) {
    return null;
  }
  const fields = migrateV3LikeToV4Fields(v3);
  return fields ? migrateV4FieldsToV5(fields) : null;
}

export function parseHandlingAssessmentJson(raw: unknown): RunHandlingAssessmentParsed | null {
  if (raw == null) return null;
  if (typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const ver = o.version;

  if (ver === 1) {
    return migrateV1ToV4(o);
  }
  if (ver === 2) {
    return migrateV2ToV4(o);
  }
  if (ver === 3) {
    return parseV3Raw(o);
  }
  if (ver === 5 || ver === 6) {
    return parseV5OrV6Raw(o);
  }
  if (ver === 4) {
    return parseV4Raw(o);
  }
  return null;
}

export function emptyHandlingAssessmentV1(): RunHandlingAssessmentParsed {
  return { version: 6 };
}

export type HandlingAssessmentUiState = {
  balanceEntry: PhaseBalance | null;
  balanceMid: PhaseBalance | null;
  balanceExit: PhaseBalance | null;
  feelVsLastRun: FeelVsLastRun | null;
  feelSteering: PhaseBalance | null;
  onPower: PhaseBalance | null;
  braking: PhaseBalance | null;
  driveEase: PhaseBalance | null;
  tractionRoll: PhaseBalance | null;
  /** Legacy only — no capture control; preserved on edit of old runs. */
  feelGeneral: PhaseBalance | null;
  speedTags: SpeedTagMap;
  primaryFocus: PrimaryFocus | null;
};

export function emptyHandlingAssessmentUiState(): HandlingAssessmentUiState {
  return {
    balanceEntry: null,
    balanceMid: null,
    balanceExit: null,
    feelVsLastRun: null,
    feelSteering: null,
    onPower: null,
    braking: null,
    driveEase: null,
    tractionRoll: null,
    feelGeneral: null,
    speedTags: {},
    primaryFocus: null,
  };
}

function phaseKeyToCornerPhase(stateKey: keyof Pick<HandlingAssessmentUiState, "balanceEntry" | "balanceMid" | "balanceExit">): CornerPhase {
  if (stateKey === "balanceEntry") return "entry";
  if (stateKey === "balanceMid") return "mid";
  return "exit";
}

export function primaryFocusMatchesUi(f: PrimaryFocus, ui: HandlingAssessmentUiState): boolean {
  switch (f.kind) {
    case "balance": {
      const v =
        f.phase === "entry" ? ui.balanceEntry : f.phase === "mid" ? ui.balanceMid : ui.balanceExit;
      return v === f.value;
    }
    case "feel_vs_last":
      return ui.feelVsLastRun === f.value;
    case "feel_steering":
      return ui.feelSteering === f.value;
    case "feel_general":
      return ui.feelGeneral === f.value;
    case "on_power":
      return ui.onPower === f.value;
    case "braking":
      return ui.braking === f.value;
    case "drive_ease":
      return ui.driveEase === f.value;
    case "traction_roll":
      return ui.tractionRoll === f.value;
    default:
      return false;
  }
}

/** Which flaggable issues are actually set in this UI state (for speed-tag validity). */
function activeIssueKeysFromUi(ui: HandlingAssessmentUiState): Set<HandlingIssueKey> {
  const keys = new Set<HandlingIssueKey>();
  if (ui.balanceEntry != null) keys.add("balance:entry");
  if (ui.balanceMid != null) keys.add("balance:mid");
  if (ui.balanceExit != null) keys.add("balance:exit");
  if (ui.feelSteering != null) keys.add("trait:feelSteering");
  if (ui.onPower != null) keys.add("trait:onPower");
  if (ui.braking != null) keys.add("trait:braking");
  if (ui.tractionRoll != null) keys.add("trait:tractionRoll");
  if (ui.driveEase != null) keys.add("trait:driveEase");
  return keys;
}

export function sanitizeHandlingUiState(ui: HandlingAssessmentUiState): HandlingAssessmentUiState {
  let next = ui;
  // Drop speed tags whose underlying issue is no longer flagged.
  if (ui.speedTags && Object.keys(ui.speedTags).length) {
    const active = activeIssueKeysFromUi(ui);
    const pruned: SpeedTagMap = {};
    let changed = false;
    for (const [key, speed] of Object.entries(ui.speedTags)) {
      if (isCornerSpeed(speed) && active.has(key as HandlingIssueKey)) {
        pruned[key as HandlingIssueKey] = speed;
      } else {
        changed = true;
      }
    }
    if (changed) next = { ...next, speedTags: pruned };
  }
  if (next.primaryFocus && !primaryFocusMatchesUi(next.primaryFocus, next)) {
    next = { ...next, primaryFocus: null };
  }
  return next;
}

function primaryFocusTraitShortLabel(axis: HandlingTraitAxisKey, v: PhaseBalance): string {
  const u = HANDLING_TRAIT_AXIS_UI[axis];
  const mag = phaseBalanceMagnitudeWord(v);
  // Single-pole traits (only one problem direction) never carry meaningful sign — the value is
  // always the same polarity — so the signed number is noise. Word-only: "Traction rolling (mild)".
  // The bipolar balance axis (steering feel) keeps the sign, where it actually denotes direction.
  const meta = (HANDLING_TRAIT_CHIP_META as Partial<
    Record<HandlingTraitAxisKey, { problemPoles: Array<{ sign: -1 | 1; label: string }> }>
  >)[axis];
  const singlePole = meta?.problemPoles.length === 1;
  if (singlePole) return mag ? `${u.title} (${mag})` : u.title;
  const magSeg = mag ? ` — ${mag}` : "";
  return `${u.title}${magSeg}: ${v > 0 ? "+" : ""}${v}`;
}

function sentenceCase(s: string): string {
  return s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}` : s;
}

function adverbForMagnitude(v: PhaseBalance): string | null {
  const a = Math.abs(v);
  if (a === 1) return "slightly";
  if (a === 2) return "moderately";
  if (a === 3) return "severely";
  return null;
}

function adjectiveForMagnitude(v: PhaseBalance): string | null {
  const a = Math.abs(v);
  if (a === 1) return "mild";
  if (a === 2) return "moderate";
  if (a === 3) return "severe";
  return null;
}

function signedValue(v: PhaseBalance): string {
  return v > 0 ? `+${v}` : String(v);
}

export function buildPrimaryFocusOptions(ui: HandlingAssessmentUiState): { id: string; focus: PrimaryFocus; label: string }[] {
  const uiSan = sanitizeHandlingUiState(ui);
  const opts: { id: string; focus: PrimaryFocus; label: string }[] = [];
  const phases: Array<{ key: "balanceEntry" | "balanceMid" | "balanceExit"; label: string }> = [
    { key: "balanceEntry", label: "Entry" },
    { key: "balanceMid", label: "Mid" },
    { key: "balanceExit", label: "Exit" },
  ];
  for (const { key, label } of phases) {
    const v = uiSan[key];
    if (v == null) continue;
    const phase = phaseKeyToCornerPhase(key);
    const f: PrimaryFocus = { kind: "balance", phase, value: v };
    opts.push({
      id: JSON.stringify(f),
      focus: f,
      label: `${label} balance: ${formatPhaseBalanceWord(v)}`,
    });
  }
  if (uiSan.feelVsLastRun != null) {
    const f: PrimaryFocus = { kind: "feel_vs_last", value: uiSan.feelVsLastRun };
    opts.push({
      id: JSON.stringify(f),
      focus: f,
      label: `Feel vs last run: ${formatFeelVsLastRunQuickLabel(uiSan.feelVsLastRun)}`,
    });
  }
  const traitFocusDefs: Array<{
    key: "feelSteering" | "onPower" | "braking" | "tractionRoll" | "driveEase" | "feelGeneral";
    axis: HandlingTraitAxisKey;
    kind: PrimaryFocus["kind"];
  }> = [
    { key: "feelSteering", axis: "feelSteering", kind: "feel_steering" },
    { key: "onPower", axis: "onPower", kind: "on_power" },
    { key: "braking", axis: "braking", kind: "braking" },
    { key: "tractionRoll", axis: "tractionRoll", kind: "traction_roll" },
    { key: "driveEase", axis: "driveEase", kind: "drive_ease" },
    { key: "feelGeneral", axis: "feelGeneral", kind: "feel_general" },
  ];
  for (const def of traitFocusDefs) {
    const v = uiSan[def.key];
    if (v == null || !isPhaseBalance(v)) continue;
    const f = { kind: def.kind, value: v } as PrimaryFocus;
    opts.push({
      id: JSON.stringify(f),
      focus: f,
      label: primaryFocusTraitShortLabel(def.axis, v),
    });
  }
  return opts;
}

export function uiStateFromParsed(parsed: RunHandlingAssessmentParsed | null): HandlingAssessmentUiState {
  if (!parsed || parsed.version !== 6) return emptyHandlingAssessmentUiState();
  const b = parsed.balanceByPhase;
  const trait = (v: PhaseBalance | undefined): PhaseBalance | null =>
    v != null && isPhaseBalance(v) ? v : null;
  const partialUi: HandlingAssessmentUiState = {
    balanceEntry: b?.entry != null && isPhaseBalance(b.entry) ? b.entry : null,
    balanceMid: b?.mid != null && isPhaseBalance(b.mid) ? b.mid : null,
    balanceExit: b?.exit != null && isPhaseBalance(b.exit) ? b.exit : null,
    feelVsLastRun:
      parsed.feelVsLastRun != null && isPhaseBalance(parsed.feelVsLastRun) ? parsed.feelVsLastRun : null,
    feelSteering: trait(parsed.feelSteering),
    onPower: trait(parsed.onPower),
    braking: trait(parsed.braking),
    driveEase: trait(parsed.driveEase),
    tractionRoll: trait(parsed.tractionRoll),
    feelGeneral: trait(parsed.feelGeneral),
    speedTags: parsed.speedTags ? { ...parsed.speedTags } : {},
    primaryFocus: null,
  };
  const base: HandlingAssessmentUiState = {
    ...partialUi,
    primaryFocus:
      parsed.primaryFocus != null && primaryFocusMatchesUi(parsed.primaryFocus, partialUi)
        ? parsed.primaryFocus
        : null,
  };
  return sanitizeHandlingUiState(base);
}

export function persistedFromUiState(ui: HandlingAssessmentUiState): RunHandlingAssessmentParsed | null {
  const uiSan = sanitizeHandlingUiState(ui);
  const t: RunHandlingAssessmentParsed = { version: 6 };
  const balanceByPhase: BalanceByPhaseMap = {};
  if (uiSan.balanceEntry != null) balanceByPhase.entry = uiSan.balanceEntry;
  if (uiSan.balanceMid != null) balanceByPhase.mid = uiSan.balanceMid;
  if (uiSan.balanceExit != null) balanceByPhase.exit = uiSan.balanceExit;
  if (Object.keys(balanceByPhase).length) t.balanceByPhase = balanceByPhase;
  if (uiSan.feelVsLastRun != null) t.feelVsLastRun = uiSan.feelVsLastRun;
  if (uiSan.feelSteering != null) t.feelSteering = uiSan.feelSteering;
  if (uiSan.onPower != null) t.onPower = uiSan.onPower;
  if (uiSan.braking != null) t.braking = uiSan.braking;
  if (uiSan.driveEase != null) t.driveEase = uiSan.driveEase;
  if (uiSan.tractionRoll != null) t.tractionRoll = uiSan.tractionRoll;
  if (uiSan.feelGeneral != null) t.feelGeneral = uiSan.feelGeneral;
  if (uiSan.speedTags && Object.keys(uiSan.speedTags).length) t.speedTags = { ...uiSan.speedTags };
  if (uiSan.primaryFocus != null && primaryFocusMatchesUi(uiSan.primaryFocus, uiSan)) {
    t.primaryFocus = uiSan.primaryFocus;
  }
  return parseHandlingAssessmentJson(t);
}

function formatFeelVsLastRun(v: FeelVsLastRun): string {
  if (v === 0) return "similar to previous run on this car (0)";
  const adv = adverbForMagnitude(v);
  const direction = v < 0 ? "worse" : "better";
  return `${adv ? `${adv} ` : ""}${direction} than previous run on this car (${signedValue(v)})`;
}

export function formatPhaseBalanceWord(v: PhaseBalance): string {
  if (v === 0) return "neutral";
  const adj = adjectiveForMagnitude(v);
  const direction = v < 0 ? "understeer" : "oversteer";
  return `${adj ? `${adj} ` : ""}${direction} (${signedValue(v)})`;
}

export function formatPrimaryFocusLine(f: PrimaryFocus): string {
  switch (f.kind) {
    case "balance":
      return `Primary focus: ${f.phase} ${formatPhaseBalanceWord(f.value)}`;
    case "feel_vs_last":
      return `Primary focus: feel vs last run — ${formatFeelVsLastRun(f.value)}`;
    case "feel_steering":
      return `Primary focus: ${primaryFocusTraitShortLabel("feelSteering", f.value)}`;
    case "feel_general":
      return `Primary focus: ${primaryFocusTraitShortLabel("feelGeneral", f.value)}`;
    case "on_power":
      return `Primary focus: ${primaryFocusTraitShortLabel("onPower", f.value)}`;
    case "braking":
      return `Primary focus: ${primaryFocusTraitShortLabel("braking", f.value)}`;
    case "drive_ease":
      return `Primary focus: ${primaryFocusTraitShortLabel("driveEase", f.value)}`;
    case "traction_roll":
      return `Primary focus: ${primaryFocusTraitShortLabel("tractionRoll", f.value)}`;
    default:
      return "";
  }
}

export function formatHandlingTraitAxisForEngineer(axis: HandlingTraitAxisKey, v: PhaseBalance): string {
  const m = HANDLING_TRAIT_AXIS_UI[axis];
  if (v === 0) return `${m.title}: neutral (0)`;
  const adv = adverbForMagnitude(v);
  const direction = v > 0 ? m.pos.toLowerCase() : m.neg.toLowerCase();
  return `${m.title}: ${adv ? `${adv} ` : ""}${direction} (${signedValue(v)})`;
}

function formatPhaseBalanceDetail(phase: CornerPhase, v: PhaseBalance): string {
  const phaseLabel = phase === "mid" ? "mid-corner" : phase;
  if (v === 0) return `Neutral ${phaseLabel} balance (0)`;
  const adj = adjectiveForMagnitude(v);
  const direction = v < 0 ? "understeer" : "oversteer";
  return sentenceCase(`${adj ? `${adj} ` : ""}${phaseLabel} ${direction} (${signedValue(v)})`);
}

export function formatHandlingAssessmentDetailLines(raw: unknown): string[] {
  const parsed = parseHandlingAssessmentJson(raw);
  if (!parsed) return [];
  const lines: string[] = [];
  if (parsed.feelVsLastRun != null && isPhaseBalance(parsed.feelVsLastRun)) {
    lines.push(`Feel vs last run: ${formatFeelVsLastRunQuickLabel(parsed.feelVsLastRun)}`);
  }
  const speed = (key: HandlingIssueKey): string => {
    const s = parsed.speedTags?.[key];
    if (!s) return "";
    if (s === "both") return " — in slow and fast corners";
    return ` — in ${CORNER_SPEED_LABELS[s]}`;
  };
  const b = parsed.balanceByPhase;
  if (b) {
    for (const p of PHASES) {
      const v = b[p];
      if (v != null && isPhaseBalance(v)) {
        lines.push(`${formatPhaseBalanceDetail(p, v)}${speed(`balance:${p}` as HandlingIssueKey)}`);
      }
    }
  }
  const traitAxes: Array<{ axis: HandlingTraitAxisKey; issue: HandlingIssueKey | null }> = [
    { axis: "feelSteering", issue: "trait:feelSteering" },
    { axis: "onPower", issue: "trait:onPower" },
    { axis: "braking", issue: "trait:braking" },
    { axis: "tractionRoll", issue: "trait:tractionRoll" },
    { axis: "driveEase", issue: "trait:driveEase" },
    { axis: "feelGeneral", issue: null },
  ];
  for (const { axis, issue } of traitAxes) {
    const v = parsed[axis];
    if (v != null && isPhaseBalance(v)) {
      lines.push(`${formatHandlingTraitAxisForEngineer(axis, v)}${issue ? speed(issue) : ""}`);
    }
  }
  return lines;
}

/**
 * Human-readable block appended to run notes for Engineer / previews.
 */
export function formatHandlingAssessmentForEngineer(raw: unknown): string {
  const parsed = parseHandlingAssessmentJson(raw);
  if (!parsed) return "";
  const lines = formatHandlingAssessmentDetailLines(parsed);
  const focusLines: string[] = [];
  if (parsed.primaryFocus) {
    const line = formatPrimaryFocusLine(parsed.primaryFocus);
    if (line) focusLines.push(line);
  }
  if (!lines.length && !focusLines.length) return "";
  return ["— Handling —", ...lines, ...focusLines].join("\n");
}

export function isHandlingAssessmentMeaningful(raw: unknown): boolean {
  return formatHandlingAssessmentForEngineer(raw).length > 0;
}
