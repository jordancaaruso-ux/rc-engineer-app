export const HANDLING_TRAIT_TAG_IDS = [
  "nervous",
  "pointy",
  "darty",
  "prone_to_flipping",
  "hard_on_kerbs",
] as const;

export type HandlingTraitTagId = (typeof HANDLING_TRAIT_TAG_IDS)[number];

export const HANDLING_TRAIT_LABELS: Record<HandlingTraitTagId, string> = {
  nervous: "Nervous",
  pointy: "Pointy",
  darty: "Darty",
  prone_to_flipping: "Prone to flipping",
  hard_on_kerbs: "Hard to use kerbs",
};

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

export type RunHandlingAssessmentParsed = {
  version: 3;
  balanceByPhase?: {
    entry?: PhaseBalance;
    mid?: PhaseBalance;
    exit?: PhaseBalance;
  };
  feelVsLastRun?: FeelVsLastRun;
  traitTags?: HandlingTraitTagId[];
  traitsOther?: string | null;
  mainProblem?: string | null;
  carDoesWell?: string | null;
};

/** @deprecated Legacy rows. */
export type RunHandlingAssessmentV1 = {
  version: 1;
  understeer?: { entry?: boolean; mid?: boolean; exit?: boolean };
  oversteer?: { entry?: boolean; mid?: boolean; exit?: boolean };
  understeerSeverity?: HandlingSeverity;
  oversteerSeverity?: HandlingSeverity;
  traitTags?: HandlingTraitTagId[];
  traitsOther?: string | null;
  mainProblem?: string | null;
  carDoesWell?: string | null;
};

/** @deprecated v2 dual-axis balance; migrated to v3 on read. */
export type RunHandlingAssessmentV2 = {
  version: 2;
  understeer?: { entry?: boolean; mid?: boolean; exit?: boolean };
  oversteer?: { entry?: boolean; mid?: boolean; exit?: boolean };
  understeerIntensity?: HandlingIntensity1to5;
  oversteerIntensity?: HandlingIntensity1to5;
  feelVsLastRun?: FeelVsLastRun;
  traitTags?: HandlingTraitTagId[];
  traitsOther?: string | null;
  mainProblem?: string | null;
  carDoesWell?: string | null;
};

const PHASES: CornerPhase[] = ["entry", "mid", "exit"];

function isTraitTagId(s: string): s is HandlingTraitTagId {
  return (HANDLING_TRAIT_TAG_IDS as readonly string[]).includes(s);
}

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

/** Map legacy 1–5 intensity to a −3…−1 or 1…3 magnitude for migration. */
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

function attachCommonFields(out: RunHandlingAssessmentParsed, o: Record<string, unknown>): void {
  if (Array.isArray(o.traitTags)) {
    const tags = o.traitTags.filter((t): t is HandlingTraitTagId => typeof t === "string" && isTraitTagId(t));
    if (tags.length) out.traitTags = tags;
  }
  if (typeof o.traitsOther === "string" && o.traitsOther.trim()) out.traitsOther = o.traitsOther.trim();
  if (typeof o.mainProblem === "string" && o.mainProblem.trim()) out.mainProblem = o.mainProblem.trim();
  if (typeof o.carDoesWell === "string" && o.carDoesWell.trim()) out.carDoesWell = o.carDoesWell.trim();
}

function migrateV1ToV3(o: Record<string, unknown>): RunHandlingAssessmentParsed | null {
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

  const out: RunHandlingAssessmentParsed = { version: 3 };
  if (Object.keys(balanceByPhase).length) out.balanceByPhase = balanceByPhase;
  attachCommonFields(out, o);

  if (!out.balanceByPhase && !out.traitTags && !out.traitsOther && !out.mainProblem && !out.carDoesWell) {
    return null;
  }
  return out;
}

function migrateV2ToV3(o: Record<string, unknown>): RunHandlingAssessmentParsed | null {
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

  const fvl = o.feelVsLastRun != null && isPhaseBalance(o.feelVsLastRun) ? o.feelVsLastRun : undefined;

  const out: RunHandlingAssessmentParsed = { version: 3 };
  if (Object.keys(balanceByPhase).length) out.balanceByPhase = balanceByPhase;
  if (fvl !== undefined) out.feelVsLastRun = fvl;
  attachCommonFields(out, o);

  if (
    !out.balanceByPhase &&
    out.feelVsLastRun === undefined &&
    !out.traitTags &&
    !out.traitsOther &&
    !out.mainProblem &&
    !out.carDoesWell
  ) {
    return null;
  }
  return out;
}

export function emptyHandlingAssessmentV1(): RunHandlingAssessmentParsed {
  return { version: 3 };
}

export type HandlingAssessmentUiState = {
  balanceEntry: PhaseBalance | null;
  balanceMid: PhaseBalance | null;
  balanceExit: PhaseBalance | null;
  feelVsLastRun: FeelVsLastRun | null;
  traitTags: HandlingTraitTagId[];
  traitsOther: string;
  mainProblem: string;
  carDoesWell: string;
};

export function emptyHandlingAssessmentUiState(): HandlingAssessmentUiState {
  return {
    balanceEntry: null,
    balanceMid: null,
    balanceExit: null,
    feelVsLastRun: null,
    traitTags: [],
    traitsOther: "",
    mainProblem: "",
    carDoesWell: "",
  };
}

export function uiStateFromParsed(parsed: RunHandlingAssessmentParsed | null): HandlingAssessmentUiState {
  if (!parsed) return emptyHandlingAssessmentUiState();
  const b = parsed.balanceByPhase;
  return {
    balanceEntry: b?.entry != null && isPhaseBalance(b.entry) ? b.entry : null,
    balanceMid: b?.mid != null && isPhaseBalance(b.mid) ? b.mid : null,
    balanceExit: b?.exit != null && isPhaseBalance(b.exit) ? b.exit : null,
    feelVsLastRun:
      parsed.feelVsLastRun != null && isPhaseBalance(parsed.feelVsLastRun) ? parsed.feelVsLastRun : null,
    traitTags: parsed.traitTags ? [...parsed.traitTags] : [],
    traitsOther: parsed.traitsOther ?? "",
    mainProblem: parsed.mainProblem ?? "",
    carDoesWell: parsed.carDoesWell ?? "",
  };
}

export function persistedFromUiState(ui: HandlingAssessmentUiState): RunHandlingAssessmentParsed | null {
  const t: RunHandlingAssessmentParsed = { version: 3 };
  const balanceByPhase: NonNullable<RunHandlingAssessmentParsed["balanceByPhase"]> = {};
  if (ui.balanceEntry != null) balanceByPhase.entry = ui.balanceEntry;
  if (ui.balanceMid != null) balanceByPhase.mid = ui.balanceMid;
  if (ui.balanceExit != null) balanceByPhase.exit = ui.balanceExit;
  if (Object.keys(balanceByPhase).length) t.balanceByPhase = balanceByPhase;
  if (ui.feelVsLastRun != null) t.feelVsLastRun = ui.feelVsLastRun;
  if (ui.traitTags.length) t.traitTags = [...ui.traitTags];
  const traitsOther = ui.traitsOther.trim();
  if (traitsOther) t.traitsOther = traitsOther;
  const mainProblem = ui.mainProblem.trim();
  if (mainProblem) t.mainProblem = mainProblem;
  const carDoesWell = ui.carDoesWell.trim();
  if (carDoesWell) t.carDoesWell = carDoesWell;
  return parseHandlingAssessmentJson(t);
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

  let traitTags: HandlingTraitTagId[] | undefined;
  if (Array.isArray(o.traitTags)) {
    const tags = o.traitTags.filter((t): t is HandlingTraitTagId => typeof t === "string" && isTraitTagId(t));
    if (tags.length) traitTags = tags;
  }
  const traitsOther =
    typeof o.traitsOther === "string" && o.traitsOther.trim() ? o.traitsOther.trim() : undefined;
  const mainProblem =
    typeof o.mainProblem === "string" && o.mainProblem.trim() ? o.mainProblem.trim() : undefined;
  const carDoesWell =
    typeof o.carDoesWell === "string" && o.carDoesWell.trim() ? o.carDoesWell.trim() : undefined;

  const out: RunHandlingAssessmentParsed = { version: 3 };
  if (Object.keys(balanceByPhase).length) out.balanceByPhase = balanceByPhase;
  if (fvl !== undefined) out.feelVsLastRun = fvl;
  if (traitTags) out.traitTags = traitTags;
  if (traitsOther) out.traitsOther = traitsOther;
  if (mainProblem) out.mainProblem = mainProblem;
  if (carDoesWell) out.carDoesWell = carDoesWell;

  if (
    !out.balanceByPhase &&
    out.feelVsLastRun === undefined &&
    !traitTags &&
    !traitsOther &&
    !mainProblem &&
    !carDoesWell
  ) {
    return null;
  }
  return out;
}

export function parseHandlingAssessmentJson(raw: unknown): RunHandlingAssessmentParsed | null {
  if (raw == null) return null;
  if (typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const ver = o.version;

  if (ver === 1) {
    return migrateV1ToV3(o);
  }
  if (ver === 2) {
    return migrateV2ToV3(o);
  }
  if (ver === 3) {
    return parseV3Raw(o);
  }
  return null;
}

function formatFeelVsLastRun(v: FeelVsLastRun): string {
  if (v === 0) return "same as last run on this car";
  if (v < 0) return `${v} (worse than last run on this car)`;
  return `+${v} (better than last run on this car)`;
}

function formatPhaseBalanceWord(v: PhaseBalance): string {
  if (v === 0) return "neutral";
  if (v < 0) return `understeer (${v})`;
  return `oversteer (+${v})`;
}

/**
 * Human-readable block appended to run notes for Engineer / previews.
 */
export function formatHandlingAssessmentForEngineer(raw: unknown): string {
  const parsed = parseHandlingAssessmentJson(raw);
  if (!parsed) return "";
  const lines: string[] = [];
  if (parsed.feelVsLastRun != null && isPhaseBalance(parsed.feelVsLastRun)) {
    lines.push(`Feel vs last run on this car: ${formatFeelVsLastRun(parsed.feelVsLastRun)}`);
  }
  const b = parsed.balanceByPhase;
  if (b && (b.entry != null || b.mid != null || b.exit != null)) {
    const parts: string[] = [];
    for (const p of PHASES) {
      const v = b[p];
      if (v != null && isPhaseBalance(v)) {
        parts.push(`${p} ${formatPhaseBalanceWord(v)}`);
      }
    }
    if (parts.length) lines.push(`Corner balance: ${parts.join("; ")}`);
  }
  if (parsed.traitTags?.length) {
    const labels = parsed.traitTags.map((id) => HANDLING_TRAIT_LABELS[id] ?? id);
    lines.push(`Traits: ${labels.join(", ")}`);
  }
  if (parsed.traitsOther?.trim()) {
    lines.push(`Other traits: ${parsed.traitsOther.trim()}`);
  }
  if (parsed.mainProblem?.trim()) {
    lines.push(`Main problem: ${parsed.mainProblem.trim()}`);
  }
  if (parsed.carDoesWell?.trim()) {
    lines.push(`Car does well: ${parsed.carDoesWell.trim()}`);
  }
  if (!lines.length) return "";
  return ["— Handling —", ...lines].join("\n");
}

export function isHandlingAssessmentMeaningful(raw: unknown): boolean {
  return formatHandlingAssessmentForEngineer(raw).length > 0;
}
