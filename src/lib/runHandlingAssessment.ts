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

/** Preset: steering response / character (no free text). */
export const STEERING_FEEL_PRESETS = ["pointy", "dull", "nervous", "neutral", "direct", "vague"] as const;
export type SteeringFeelPreset = (typeof STEERING_FEEL_PRESETS)[number];
export const STEERING_FEEL_LABELS: Record<SteeringFeelPreset, string> = {
  pointy: "Pointy",
  dull: "Dull",
  nervous: "Nervous",
  neutral: "Neutral",
  direct: "Direct",
  vague: "Vague",
};

/** Preset: overall chassis character. */
export const GENERAL_FEEL_PRESETS = ["smooth", "plush", "aggressive", "sharp"] as const;
export type GeneralFeelPreset = (typeof GENERAL_FEEL_PRESETS)[number];
export const GENERAL_FEEL_LABELS: Record<GeneralFeelPreset, string> = {
  smooth: "Smooth",
  plush: "Plush",
  aggressive: "Aggressive",
  sharp: "Sharp",
};

export const DRIVE_DIFFICULTY_PRESETS = ["easy", "hard"] as const;
export type DriveDifficultyPreset = (typeof DRIVE_DIFFICULTY_PRESETS)[number];
export const DRIVE_DIFFICULTY_LABELS: Record<DriveDifficultyPreset, string> = {
  easy: "Easy",
  hard: "Hard",
};

/** Optional multi-select “single issue” tags (preset ids only). */
export const SINGLE_TRAIT_IDS = ["traction_roll", "on_power_snaps", "rear_grip_limit"] as const;
export type SingleTraitTagId = (typeof SINGLE_TRAIT_IDS)[number];
export const SINGLE_TRAIT_LABELS: Record<SingleTraitTagId, string> = {
  traction_roll: "Traction roll",
  on_power_snaps: "On-power snaps",
  rear_grip_limit: "Rear grip limit",
};

/** What the car did well — multi preset, no free text. */
export const DOES_WELL_IDS = [
  "predictable_limit",
  "good_rotation",
  "stable_on_throttle",
  "confident_braking",
  "easy_to_place",
] as const;
export type DoesWellPresetId = (typeof DOES_WELL_IDS)[number];
export const DOES_WELL_LABELS: Record<DoesWellPresetId, string> = {
  predictable_limit: "Predictable at the limit",
  good_rotation: "Good rotation",
  stable_on_throttle: "Stable on throttle",
  confident_braking: "Confident braking",
  easy_to_place: "Easy to place",
};

/** Which dimension is the primary focus (must match a selection already made). */
export type PrimaryFocus =
  | { kind: "balance"; phase: CornerPhase; value: PhaseBalance }
  | { kind: "feel_vs_last"; value: FeelVsLastRun }
  | { kind: "steering_feel"; value: SteeringFeelPreset }
  | { kind: "general_feel"; value: GeneralFeelPreset }
  | { kind: "drive_difficulty"; value: DriveDifficultyPreset }
  | { kind: "single_trait"; value: SingleTraitTagId }
  | { kind: "does_well"; value: DoesWellPresetId };

/** Persisted JSON (current). All optional strings removed — presets only. */
export type RunHandlingAssessmentParsed = {
  version: 4;
  balanceByPhase?: {
    entry?: PhaseBalance;
    mid?: PhaseBalance;
    exit?: PhaseBalance;
  };
  feelVsLastRun?: FeelVsLastRun;
  steeringFeel?: SteeringFeelPreset;
  generalFeel?: GeneralFeelPreset;
  driveDifficulty?: DriveDifficultyPreset;
  singleTraits?: SingleTraitTagId[];
  doesWell?: DoesWellPresetId[];
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
  balanceByPhase?: RunHandlingAssessmentParsed["balanceByPhase"];
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

function v4HasAnyContent(t: RunHandlingAssessmentParsed): boolean {
  return (
    Boolean(
      t.balanceByPhase &&
        (t.balanceByPhase.entry != null ||
          t.balanceByPhase.mid != null ||
          t.balanceByPhase.exit != null)
    ) ||
    t.feelVsLastRun != null ||
    t.steeringFeel != null ||
    t.generalFeel != null ||
    t.driveDifficulty != null ||
    (t.singleTraits != null && t.singleTraits.length > 0) ||
    (t.doesWell != null && t.doesWell.length > 0) ||
    t.primaryFocus != null
  );
}

function finalizeV4(t: RunHandlingAssessmentParsed): RunHandlingAssessmentParsed | null {
  return v4HasAnyContent(t) ? t : null;
}

function migrateV3LikeToV4(v3: V3Like): RunHandlingAssessmentParsed | null {
  const out: RunHandlingAssessmentParsed = { version: 4 };
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
  return finalizeV4(out);
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

  const balanceByPhase: NonNullable<RunHandlingAssessmentParsed["balanceByPhase"]> = {};
  for (const p of PHASES) {
    const b = mergeLegacyUsOsForPhase(understeer?.[p], oversteer?.[p], ui, oi);
    if (b !== null) balanceByPhase[p] = b;
  }

  const v3: V3Like = {};
  if (Object.keys(balanceByPhase).length) v3.balanceByPhase = balanceByPhase;
  attachLegacyCommonToV3Like(v3, o);
  return migrateV3LikeToV4(v3);
}

function migrateV2ToV4(o: Record<string, unknown>): RunHandlingAssessmentParsed | null {
  const understeer = normalizePhaseBlock(o.understeer);
  const oversteer = normalizePhaseBlock(o.oversteer);
  const ui =
    o.understeerIntensity != null && isIntensity1to5(o.understeerIntensity) ? o.understeerIntensity : 3;
  const oi =
    o.oversteerIntensity != null && isIntensity1to5(o.oversteerIntensity) ? o.oversteerIntensity : 3;

  const balanceByPhase: NonNullable<RunHandlingAssessmentParsed["balanceByPhase"]> = {};
  for (const p of PHASES) {
    const b = mergeLegacyUsOsForPhase(understeer?.[p], oversteer?.[p], ui, oi);
    if (b !== null) balanceByPhase[p] = b;
  }

  const v3: V3Like = {};
  if (Object.keys(balanceByPhase).length) v3.balanceByPhase = balanceByPhase;
  if (o.feelVsLastRun != null && isPhaseBalance(o.feelVsLastRun)) v3.feelVsLastRun = o.feelVsLastRun;
  attachLegacyCommonToV3Like(v3, o);
  return migrateV3LikeToV4(v3);
}

function parsePrimaryFocus(raw: unknown): PrimaryFocus | undefined {
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

function parseV4Raw(o: Record<string, unknown>): RunHandlingAssessmentParsed | null {
  const bb = o.balanceByPhase;
  const balanceByPhase: NonNullable<RunHandlingAssessmentParsed["balanceByPhase"]> = {};
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
  const primaryFocus = parsePrimaryFocus(o.primaryFocus);

  const out: RunHandlingAssessmentParsed = { version: 4 };
  if (Object.keys(balanceByPhase).length) out.balanceByPhase = balanceByPhase;
  if (fvl !== undefined) out.feelVsLastRun = fvl;
  if (steeringFeel) out.steeringFeel = steeringFeel;
  if (generalFeel) out.generalFeel = generalFeel;
  if (driveDifficulty) out.driveDifficulty = driveDifficulty;
  if (singleTraits) out.singleTraits = singleTraits;
  if (doesWell) out.doesWell = doesWell;
  if (primaryFocus) out.primaryFocus = primaryFocus;

  return finalizeV4(out);
}

function parseV3Raw(o: Record<string, unknown>): RunHandlingAssessmentParsed | null {
  const bb = o.balanceByPhase;
  const balanceByPhase: NonNullable<RunHandlingAssessmentParsed["balanceByPhase"]> = {};
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
  return migrateV3LikeToV4(v3);
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
  if (ver === 4) {
    return parseV4Raw(o);
  }
  return null;
}

export function emptyHandlingAssessmentV1(): RunHandlingAssessmentParsed {
  return { version: 4 };
}

export type HandlingAssessmentUiState = {
  balanceEntry: PhaseBalance | null;
  balanceMid: PhaseBalance | null;
  balanceExit: PhaseBalance | null;
  feelVsLastRun: FeelVsLastRun | null;
  steeringFeel: SteeringFeelPreset | null;
  generalFeel: GeneralFeelPreset | null;
  driveDifficulty: DriveDifficultyPreset | null;
  singleTraits: SingleTraitTagId[];
  doesWell: DoesWellPresetId[];
  primaryFocus: PrimaryFocus | null;
};

export function emptyHandlingAssessmentUiState(): HandlingAssessmentUiState {
  return {
    balanceEntry: null,
    balanceMid: null,
    balanceExit: null,
    feelVsLastRun: null,
    steeringFeel: null,
    generalFeel: null,
    driveDifficulty: null,
    singleTraits: [],
    doesWell: [],
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
    case "steering_feel":
      return ui.steeringFeel === f.value;
    case "general_feel":
      return ui.generalFeel === f.value;
    case "drive_difficulty":
      return ui.driveDifficulty === f.value;
    case "single_trait":
      return ui.singleTraits.includes(f.value);
    case "does_well":
      return ui.doesWell.includes(f.value);
    default:
      return false;
  }
}

export function sanitizeHandlingUiState(ui: HandlingAssessmentUiState): HandlingAssessmentUiState {
  if (!ui.primaryFocus) return ui;
  if (primaryFocusMatchesUi(ui.primaryFocus, ui)) return ui;
  return { ...ui, primaryFocus: null };
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
      label: `Feel vs last run: ${formatFeelVsLastRun(uiSan.feelVsLastRun)}`,
    });
  }
  if (uiSan.steeringFeel != null) {
    const f: PrimaryFocus = { kind: "steering_feel", value: uiSan.steeringFeel };
    opts.push({
      id: JSON.stringify(f),
      focus: f,
      label: `Steering feel: ${STEERING_FEEL_LABELS[uiSan.steeringFeel]}`,
    });
  }
  if (uiSan.generalFeel != null) {
    const f: PrimaryFocus = { kind: "general_feel", value: uiSan.generalFeel };
    opts.push({
      id: JSON.stringify(f),
      focus: f,
      label: `General feel: ${GENERAL_FEEL_LABELS[uiSan.generalFeel]}`,
    });
  }
  if (uiSan.driveDifficulty != null) {
    const f: PrimaryFocus = { kind: "drive_difficulty", value: uiSan.driveDifficulty };
    opts.push({
      id: JSON.stringify(f),
      focus: f,
      label: `Difficulty to drive: ${DRIVE_DIFFICULTY_LABELS[uiSan.driveDifficulty]}`,
    });
  }
  for (const id of uiSan.singleTraits) {
    const f: PrimaryFocus = { kind: "single_trait", value: id };
    opts.push({
      id: JSON.stringify(f),
      focus: f,
      label: `Issue: ${SINGLE_TRAIT_LABELS[id]}`,
    });
  }
  for (const id of uiSan.doesWell) {
    const f: PrimaryFocus = { kind: "does_well", value: id };
    opts.push({
      id: JSON.stringify(f),
      focus: f,
      label: `Does well: ${DOES_WELL_LABELS[id]}`,
    });
  }
  return opts;
}

export function uiStateFromParsed(parsed: RunHandlingAssessmentParsed | null): HandlingAssessmentUiState {
  if (!parsed || parsed.version !== 4) return emptyHandlingAssessmentUiState();
  const b = parsed.balanceByPhase;
  const base: HandlingAssessmentUiState = {
    balanceEntry: b?.entry != null && isPhaseBalance(b.entry) ? b.entry : null,
    balanceMid: b?.mid != null && isPhaseBalance(b.mid) ? b.mid : null,
    balanceExit: b?.exit != null && isPhaseBalance(b.exit) ? b.exit : null,
    feelVsLastRun:
      parsed.feelVsLastRun != null && isPhaseBalance(parsed.feelVsLastRun) ? parsed.feelVsLastRun : null,
    steeringFeel:
      parsed.steeringFeel != null && isSteeringFeelPreset(parsed.steeringFeel) ? parsed.steeringFeel : null,
    generalFeel:
      parsed.generalFeel != null && isGeneralFeelPreset(parsed.generalFeel) ? parsed.generalFeel : null,
    driveDifficulty:
      parsed.driveDifficulty != null && isDriveDifficultyPreset(parsed.driveDifficulty)
        ? parsed.driveDifficulty
        : null,
    singleTraits: parsed.singleTraits ? [...parsed.singleTraits] : [],
    doesWell: parsed.doesWell ? [...parsed.doesWell] : [],
    primaryFocus:
      parsed.primaryFocus != null && primaryFocusMatchesUi(parsed.primaryFocus, {
        balanceEntry: b?.entry != null && isPhaseBalance(b.entry) ? b.entry : null,
        balanceMid: b?.mid != null && isPhaseBalance(b.mid) ? b.mid : null,
        balanceExit: b?.exit != null && isPhaseBalance(b.exit) ? b.exit : null,
        feelVsLastRun:
          parsed.feelVsLastRun != null && isPhaseBalance(parsed.feelVsLastRun) ? parsed.feelVsLastRun : null,
        steeringFeel:
          parsed.steeringFeel != null && isSteeringFeelPreset(parsed.steeringFeel) ? parsed.steeringFeel : null,
        generalFeel:
          parsed.generalFeel != null && isGeneralFeelPreset(parsed.generalFeel) ? parsed.generalFeel : null,
        driveDifficulty:
          parsed.driveDifficulty != null && isDriveDifficultyPreset(parsed.driveDifficulty)
            ? parsed.driveDifficulty
            : null,
        singleTraits: parsed.singleTraits ? [...parsed.singleTraits] : [],
        doesWell: parsed.doesWell ? [...parsed.doesWell] : [],
        primaryFocus: null,
      })
        ? parsed.primaryFocus
        : null,
  };
  return sanitizeHandlingUiState(base);
}

export function persistedFromUiState(ui: HandlingAssessmentUiState): RunHandlingAssessmentParsed | null {
  const uiSan = sanitizeHandlingUiState(ui);
  const t: RunHandlingAssessmentParsed = { version: 4 };
  const balanceByPhase: NonNullable<RunHandlingAssessmentParsed["balanceByPhase"]> = {};
  if (uiSan.balanceEntry != null) balanceByPhase.entry = uiSan.balanceEntry;
  if (uiSan.balanceMid != null) balanceByPhase.mid = uiSan.balanceMid;
  if (uiSan.balanceExit != null) balanceByPhase.exit = uiSan.balanceExit;
  if (Object.keys(balanceByPhase).length) t.balanceByPhase = balanceByPhase;
  if (uiSan.feelVsLastRun != null) t.feelVsLastRun = uiSan.feelVsLastRun;
  if (uiSan.steeringFeel != null) t.steeringFeel = uiSan.steeringFeel;
  if (uiSan.generalFeel != null) t.generalFeel = uiSan.generalFeel;
  if (uiSan.driveDifficulty != null) t.driveDifficulty = uiSan.driveDifficulty;
  if (uiSan.singleTraits.length) t.singleTraits = [...uiSan.singleTraits];
  if (uiSan.doesWell.length) t.doesWell = [...uiSan.doesWell];
  if (uiSan.primaryFocus != null && primaryFocusMatchesUi(uiSan.primaryFocus, uiSan)) {
    t.primaryFocus = uiSan.primaryFocus;
  }
  return parseHandlingAssessmentJson(t);
}

function formatFeelVsLastRun(v: FeelVsLastRun): string {
  if (v === 0) return "same as last run on this car";
  if (v < 0) return `${v} (worse than last run on this car)`;
  return `+${v} (better than last run on this car)`;
}

function formatPhaseBalanceWord(v: PhaseBalance): string {
  if (v === 0) return "neutral";
  if (v < 0) return `toward push (${v})`;
  return `toward oversteer (+${v})`;
}

export function formatPrimaryFocusLine(f: PrimaryFocus): string {
  switch (f.kind) {
    case "balance":
      return `Primary focus: ${f.phase} ${formatPhaseBalanceWord(f.value)}`;
    case "feel_vs_last":
      return `Primary focus: feel vs last run — ${formatFeelVsLastRun(f.value)}`;
    case "steering_feel":
      return `Primary focus: steering feel — ${STEERING_FEEL_LABELS[f.value]}`;
    case "general_feel":
      return `Primary focus: general feel — ${GENERAL_FEEL_LABELS[f.value]}`;
    case "drive_difficulty":
      return `Primary focus: difficulty — ${DRIVE_DIFFICULTY_LABELS[f.value]}`;
    case "single_trait":
      return `Primary focus: ${SINGLE_TRAIT_LABELS[f.value]}`;
    case "does_well":
      return `Primary focus (strength): ${DOES_WELL_LABELS[f.value]}`;
    default:
      return "";
  }
}

/**
 * Human-readable block appended to run notes for Engineer / previews.
 */
export function formatHandlingAssessmentForEngineer(raw: unknown): string {
  const parsed = parseHandlingAssessmentJson(raw);
  if (!parsed) return "";
  const lines: string[] = [];
  const b = parsed.balanceByPhase;
  if (b && (b.entry != null || b.mid != null || b.exit != null)) {
    const parts: string[] = [];
    for (const p of PHASES) {
      const v = b[p];
      if (v != null && isPhaseBalance(v)) {
        parts.push(`${p} ${formatPhaseBalanceWord(v)}`);
      }
    }
    if (parts.length) lines.push(`Corner balance (−3 push … +3 oversteer): ${parts.join("; ")}`);
  }
  if (parsed.feelVsLastRun != null && isPhaseBalance(parsed.feelVsLastRun)) {
    lines.push(`Feel vs last run on this car: ${formatFeelVsLastRun(parsed.feelVsLastRun)}`);
  }
  if (parsed.steeringFeel) {
    lines.push(`Steering feel: ${STEERING_FEEL_LABELS[parsed.steeringFeel]}`);
  }
  if (parsed.generalFeel) {
    lines.push(`General feel: ${GENERAL_FEEL_LABELS[parsed.generalFeel]}`);
  }
  if (parsed.driveDifficulty) {
    lines.push(`Difficulty to drive: ${DRIVE_DIFFICULTY_LABELS[parsed.driveDifficulty]}`);
  }
  if (parsed.singleTraits?.length) {
    lines.push(`Single traits: ${parsed.singleTraits.map((id) => SINGLE_TRAIT_LABELS[id]).join(", ")}`);
  }
  if (parsed.doesWell?.length) {
    lines.push(`Does well: ${parsed.doesWell.map((id) => DOES_WELL_LABELS[id]).join(", ")}`);
  }
  if (parsed.primaryFocus) {
    const line = formatPrimaryFocusLine(parsed.primaryFocus);
    if (line) lines.push(line);
  }
  if (!lines.length) return "";
  return ["— Handling —", ...lines].join("\n");
}

export function isHandlingAssessmentMeaningful(raw: unknown): boolean {
  return formatHandlingAssessmentForEngineer(raw).length > 0;
}
