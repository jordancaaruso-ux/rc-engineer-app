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

export type HandlingSeverity = "mild" | "moderate" | "severe";

export const HANDLING_SEVERITY_LABELS: Record<HandlingSeverity, string> = {
  mild: "mild",
  moderate: "moderate",
  severe: "severe",
};

export type RunHandlingAssessmentV1 = {
  version: 1;
  understeer?: { entry?: boolean; mid?: boolean; exit?: boolean };
  oversteer?: { entry?: boolean; mid?: boolean; exit?: boolean };
  /** When understeer phases are set; omit if legacy data. */
  understeerSeverity?: HandlingSeverity;
  oversteerSeverity?: HandlingSeverity;
  traitTags?: HandlingTraitTagId[];
  traitsOther?: string | null;
  mainProblem?: string | null;
  carDoesWell?: string | null;
};

const PHASES: CornerPhase[] = ["entry", "mid", "exit"];

function isTraitTagId(s: string): s is HandlingTraitTagId {
  return (HANDLING_TRAIT_TAG_IDS as readonly string[]).includes(s);
}

function isSeverity(s: string): s is HandlingSeverity {
  return s === "mild" || s === "moderate" || s === "severe";
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

export function emptyHandlingAssessmentV1(): RunHandlingAssessmentV1 {
  return { version: 1 };
}

export type HandlingAssessmentUiState = {
  understeer: { entry?: boolean; mid?: boolean; exit?: boolean } | null;
  oversteer: { entry?: boolean; mid?: boolean; exit?: boolean } | null;
  understeerSeverity: HandlingSeverity;
  oversteerSeverity: HandlingSeverity;
  traitTags: HandlingTraitTagId[];
  traitsOther: string;
  mainProblem: string;
  carDoesWell: string;
};

export function emptyHandlingAssessmentUiState(): HandlingAssessmentUiState {
  return {
    understeer: null,
    oversteer: null,
    understeerSeverity: "moderate",
    oversteerSeverity: "moderate",
    traitTags: [],
    traitsOther: "",
    mainProblem: "",
    carDoesWell: "",
  };
}

export function uiStateFromParsed(parsed: RunHandlingAssessmentV1 | null): HandlingAssessmentUiState {
  if (!parsed) return emptyHandlingAssessmentUiState();
  return {
    understeer: parsed.understeer ? { ...parsed.understeer } : null,
    oversteer: parsed.oversteer ? { ...parsed.oversteer } : null,
    understeerSeverity: parsed.understeerSeverity ?? "moderate",
    oversteerSeverity: parsed.oversteerSeverity ?? "moderate",
    traitTags: parsed.traitTags ? [...parsed.traitTags] : [],
    traitsOther: parsed.traitsOther ?? "",
    mainProblem: parsed.mainProblem ?? "",
    carDoesWell: parsed.carDoesWell ?? "",
  };
}

export function persistedFromUiState(ui: HandlingAssessmentUiState): RunHandlingAssessmentV1 | null {
  const t: RunHandlingAssessmentV1 = { version: 1 };
  if (ui.understeer) {
    const u: { entry?: boolean; mid?: boolean; exit?: boolean } = {};
    for (const p of PHASES) {
      if (ui.understeer[p]) u[p] = true;
    }
    if (Object.keys(u).length) {
      t.understeer = u;
      t.understeerSeverity = ui.understeerSeverity;
    }
  }
  if (ui.oversteer) {
    const o: { entry?: boolean; mid?: boolean; exit?: boolean } = {};
    for (const p of PHASES) {
      if (ui.oversteer[p]) o[p] = true;
    }
    if (Object.keys(o).length) {
      t.oversteer = o;
      t.oversteerSeverity = ui.oversteerSeverity;
    }
  }
  if (ui.traitTags.length) t.traitTags = [...ui.traitTags];
  const traitsOther = ui.traitsOther.trim();
  if (traitsOther) t.traitsOther = traitsOther;
  const mainProblem = ui.mainProblem.trim();
  if (mainProblem) t.mainProblem = mainProblem;
  const carDoesWell = ui.carDoesWell.trim();
  if (carDoesWell) t.carDoesWell = carDoesWell;
  return parseHandlingAssessmentJson(t);
}

export function parseHandlingAssessmentJson(raw: unknown): RunHandlingAssessmentV1 | null {
  if (raw == null) return null;
  if (typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return null;
  const understeer = normalizePhaseBlock(o.understeer);
  const oversteer = normalizePhaseBlock(o.oversteer);
  const us =
    typeof o.understeerSeverity === "string" && isSeverity(o.understeerSeverity)
      ? o.understeerSeverity
      : undefined;
  const os =
    typeof o.oversteerSeverity === "string" && isSeverity(o.oversteerSeverity)
      ? o.oversteerSeverity
      : undefined;
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

  const out: RunHandlingAssessmentV1 = { version: 1 };
  if (understeer) {
    out.understeer = understeer;
    if (us) out.understeerSeverity = us;
  }
  if (oversteer) {
    out.oversteer = oversteer;
    if (os) out.oversteerSeverity = os;
  }
  if (traitTags) out.traitTags = traitTags;
  if (traitsOther) out.traitsOther = traitsOther;
  if (mainProblem) out.mainProblem = mainProblem;
  if (carDoesWell) out.carDoesWell = carDoesWell;

  if (
    !understeer &&
    !oversteer &&
    !traitTags &&
    !traitsOther &&
    !mainProblem &&
    !carDoesWell
  ) {
    return null;
  }
  return out;
}

function hasAnyPhase(block?: { entry?: boolean; mid?: boolean; exit?: boolean }): boolean {
  if (!block) return false;
  return PHASES.some((p) => block[p] === true);
}

function formatBalanceLine(
  label: "Understeer" | "Oversteer",
  block: { entry?: boolean; mid?: boolean; exit?: boolean } | undefined,
  severity: HandlingSeverity | undefined
): string | null {
  if (!block) return null;
  const parts: string[] = [];
  for (const p of PHASES) {
    if (block[p]) parts.push(p);
  }
  if (!parts.length) return null;
  const sev =
    severity && HANDLING_SEVERITY_LABELS[severity]
      ? ` (${HANDLING_SEVERITY_LABELS[severity]})`
      : "";
  return `${label}${sev}: ${parts.join(", ")}`;
}

/**
 * Human-readable block appended to run notes for Engineer / previews.
 */
export function formatHandlingAssessmentForEngineer(raw: unknown): string {
  const parsed = parseHandlingAssessmentJson(raw);
  if (!parsed) return "";
  const lines: string[] = [];
  const u = formatBalanceLine(
    "Understeer",
    parsed.understeer,
    hasAnyPhase(parsed.understeer) ? parsed.understeerSeverity : undefined
  );
  const o = formatBalanceLine(
    "Oversteer",
    parsed.oversteer,
    hasAnyPhase(parsed.oversteer) ? parsed.oversteerSeverity : undefined
  );
  if (u) lines.push(u);
  if (o) lines.push(o);
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
