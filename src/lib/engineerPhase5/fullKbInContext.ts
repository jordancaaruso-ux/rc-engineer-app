import "server-only";

import { loadFullVehicleDynamicsKb } from "@/lib/engineerPhase5/vehicleDynamicsKb";

/**
 * Full-KB-in-context (ENGINEER_NORTH_STAR.md, knowledge architecture): full-tier advice
 * turns carry the whole vehicle-dynamics corpus as a static system message instead of
 * per-turn retrieved excerpts — kills the retrieval-miss failure class. Retrieval returns
 * only if the corpus outgrows this ceiling (~50K tokens per the north star).
 */
const FULL_KB_MAX_CHARS = 190_000;

/** Kill switch: set ENGINEER_FULL_KB_IN_CONTEXT=0 to restore per-turn retrieval snippets. */
export function fullKbInContextEnabled(): boolean {
  const v = process.env.ENGINEER_FULL_KB_IN_CONTEXT?.trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "off");
}

export type FullKbSystemBlock = {
  /** Complete system-message content: header + every KB file's full prose. */
  content: string;
  files: string[];
  totalChars: number;
};

const FULL_KB_HEADER = `VEHICLE DYNAMICS KB — FULL TEXT (canonical, hand-curated ground truth).
This is the COMPLETE vehicle-dynamics knowledge base: every file, full prose. It is the corpus the instructions and context JSON call "vehicleDynamicsKb". Per-turn retrieved excerpts are retired — richEngineerContext.vehicleDynamicsKb and focusedRunPair.setupCompareKbSnippets carry only a pointer to this block, so wherever the instructions mention retrieved snippets or excerpts, read the relevant file below instead. Never claim a KB excerpt "didn't make retrieval" or that KB coverage is missing for a parameter documented below — everything is here. All KB rules apply to these files: cite filenames (e.g. \`damper-oil.md\`), never contradict them, preserve their hedges.

PROVENANCE TIERS: files above the "AI-DRAFTED BASELINE FILES" divider are founder-approved ground truth — cite them plainly. Files below it (marked "AI DRAFT — unverified") are AI-researched baseline theory: use them, but cite as "draft \`file.md\`" with hedged wording ("general vehicle-dynamics theory — not yet verified for this KB"), never with the same authority as approved files, and if a draft and an approved file disagree, the approved file wins without exception.

`;

/**
 * Build the static full-KB system message for a full-tier advice turn.
 * Returns null when the feature is disabled, the KB directory is empty, or the corpus
 * has outgrown the in-context ceiling — callers fall back to retrieval snippets.
 */
export async function buildFullKbSystemBlock(): Promise<FullKbSystemBlock | null> {
  if (!fullKbInContextEnabled()) return null;
  const kb = await loadFullVehicleDynamicsKb();
  if (kb.files.length === 0) return null;
  if (kb.totalChars > FULL_KB_MAX_CHARS) return null;
  return {
    content: FULL_KB_HEADER + kb.markdown,
    files: kb.files,
    totalChars: kb.totalChars,
  };
}

export const FULL_KB_POINTER_SNIPPET = {
  title: "Full KB in context — excerpts retired",
  sourcePath: "vehicle-dynamics/",
  excerpt:
    "The complete vehicle-dynamics KB (every file, full prose) is in the first system message. Read parameter directions, hedges, and mechanism language directly from those files and cite filenames as usual.",
} as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Swap per-turn retrieved KB excerpt arrays for a single pointer entry in the serialized
 * context (the full prose ships separately as a system message). Non-mutating — callers
 * keep the original context (with real snippets) so a fallback to retrieval, response
 * metadata, and persisted contextJson are unaffected.
 */
export function replaceRetrievedKbWithFullKbPointer(contextJson: unknown): unknown {
  if (!isRecord(contextJson)) return contextJson;
  const out: Record<string, unknown> = { ...contextJson };
  if (
    isRecord(out.richEngineerContext) &&
    Array.isArray(out.richEngineerContext.vehicleDynamicsKb)
  ) {
    out.richEngineerContext = {
      ...out.richEngineerContext,
      vehicleDynamicsKb: [FULL_KB_POINTER_SNIPPET],
    };
  }
  if (
    isRecord(out.focusedRunPair) &&
    Array.isArray(out.focusedRunPair.setupCompareKbSnippets)
  ) {
    out.focusedRunPair = {
      ...out.focusedRunPair,
      setupCompareKbSnippets: [FULL_KB_POINTER_SNIPPET],
    };
  }
  return out;
}
