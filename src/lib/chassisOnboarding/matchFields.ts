import { corpusMatchTokens, isPositionalToken, type CorpusEntry } from "@/lib/chassisOnboarding/labelCorpus";
import { suggestUniversalParameterId } from "@/lib/setupSheetModels/matchUniversalParameter";
import { lookupUniversalParameterDef } from "@/lib/setupSheetModels/universalParameters";

/**
 * Decide which already-approved label a blank sheet's AcroForm field is, or admit it doesn't know.
 *
 * Three outcomes, and the split is the point:
 *  - `auto`      — safe to apply without asking. Only the conservative registry resolver, or a
 *                  near-perfect and *unambiguous* token match, gets here.
 *  - `suggested` — a plausible label a human confirms in the wizard.
 *  - `residue`   — no opinion. The field still ships, as a plain text row named from the PDF.
 *
 * Never guessing is the whole design: a field left in residue costs one wizard step, while a wrong
 * name that looked confident costs trust in every other row on the sheet.
 */

export type MatchTier = "auto" | "suggested" | "residue";

export type FieldMatch = {
  tier: MatchTier;
  entry?: CorpusEntry;
  /** 0..1 token agreement; 1 when the registry resolved it outright. */
  score: number;
  /** Why this tier — surfaced in eval output and useful when a sheet matches badly. */
  reason: "registry" | "token" | "ambiguous" | "weak" | "opaque_name";
  /** Runner-up labels worth offering in the wizard picker. */
  alternates: CorpusEntry[];
};

export type OnboardingFieldInput = {
  key: string;
  acroName: string;
  /**
   * The caption printed beside the box on the sheet, from the PDF's text layer.
   *
   * Usually a far better signal than the field name — Mugen and Awesomatix ship Acrobat defaults
   * like `Text47`, but both print "CAMBER" next to the camber box. It also gives the wizard a
   * proposed label for fields that match nothing, so an unmatched box is a word to confirm rather
   * than a name to invent.
   */
  printedLabel?: string;
};

const AUTO_TOKEN_SCORE = 0.9;
const SUGGEST_TOKEN_SCORE = 0.5;
/** Below this gap to the runner-up, two labels are competing and neither may auto-apply. */
const AMBIGUITY_MARGIN = 0.08;

/**
 * F1 over token sets rather than plain overlap: a corpus entry must both cover the field's words
 * and not carry many extra ones. Bare overlap would let a long label win by containing everything.
 *
 * Agreement on a side alone scores zero. Without that rule every `fr-*` field on an Xray sheet
 * matched "Toe (Front)" at 0.5 — rebound, pistons, body posts and brace all "matched", which is
 * how a suggestion list stops being worth reading.
 */
function tokenScore(fieldTokens: string[], entryTokens: string[]): number {
  if (fieldTokens.length === 0 || entryTokens.length === 0) return 0;
  const entrySet = new Set(entryTokens);
  const fieldSet = new Set(fieldTokens);
  let shared = 0;
  let sharedConcepts = 0;
  for (const t of fieldSet) {
    if (!entrySet.has(t)) continue;
    shared += 1;
    if (!isPositionalToken(t)) sharedConcepts += 1;
  }
  if (sharedConcepts === 0) return 0;
  const precision = shared / fieldSet.size;
  const recall = shared / entrySet.size;
  return (2 * precision * recall) / (precision + recall);
}

function bestVariantScore(fieldTokens: string[], entry: CorpusEntry): number {
  let best = 0;
  for (const variant of entry.tokens) {
    const s = tokenScore(fieldTokens, variant);
    if (s > best) best = s;
  }
  return best;
}

function entryForUniversalId(id: string, corpus: CorpusEntry[]): CorpusEntry | undefined {
  const direct = corpus.find((e) => e.universalParameterId === id);
  if (direct) return direct;
  // The registry can resolve an id the corpus hasn't got an entry for; synthesize from its own def
  // so the label is still one the founder published.
  const def = lookupUniversalParameterDef(id);
  if (!def) return undefined;
  return {
    id: `universal:${def.id}`,
    displayLabel: def.label,
    universalParameterId: def.id,
    source: "universal",
    tokens: [corpusMatchTokens(def.id)],
  };
}

export function matchFieldToCorpus(
  field: OnboardingFieldInput,
  corpus: CorpusEntry[]
): FieldMatch {
  // 1) The conservative registry resolver. It returns undefined rather than guess a side, and its
  // hits are exactly the ones that must carry a universalParameterId for community pooling.
  const universalId = suggestUniversalParameterId(
    field.key,
    [field.acroName, field.printedLabel].filter(Boolean).join(" ")
  );
  if (universalId) {
    const entry = entryForUniversalId(universalId, corpus);
    if (entry) return { tier: "auto", entry, score: 1, reason: "registry", alternates: [] };
  }

  // 2) Token agreement against the wider vocabulary.
  const fieldTokens = corpusMatchTokens(
    [field.acroName, field.key, field.printedLabel].filter(Boolean).join(" ")
  );
  if (fieldTokens.length === 0) {
    return { tier: "residue", score: 0, reason: "opaque_name", alternates: [] };
  }

  const scored = corpus
    .map((entry) => ({ entry, score: bestVariantScore(fieldTokens, entry) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { tier: "residue", score: 0, reason: "weak", alternates: [] };
  }

  const best = scored[0]!;
  const runnerUp = scored[1];
  const alternates = scored.slice(1, 4).map((s) => s.entry);
  const contested = runnerUp != null && best.score - runnerUp.score < AMBIGUITY_MARGIN;

  if (best.score >= AUTO_TOKEN_SCORE && !contested) {
    return { tier: "auto", entry: best.entry, score: best.score, reason: "token", alternates };
  }
  if (best.score >= SUGGEST_TOKEN_SCORE) {
    return {
      tier: "suggested",
      entry: best.entry,
      score: best.score,
      reason: contested ? "ambiguous" : "token",
      alternates,
    };
  }
  return { tier: "residue", score: best.score, reason: "weak", alternates };
}

/**
 * Two boxes on one sheet cannot be the same parameter. When several fields claim one label the
 * matcher has no way to tell which is the real one, so none of them may auto-apply.
 *
 * This is not hypothetical: on the X4'26 sheet both `re-caster` and `re-uppr-links-caster` resolve
 * to "Caster (Rear)". Left alone, one silently overwrites the other and the sheet quietly loses a
 * parameter — the kind of fault nobody finds until a driver's setup reads wrong.
 */
export function demoteCollidingMatches(matches: Map<string, FieldMatch>): void {
  const claimants = new Map<string, string[]>();
  for (const [key, match] of matches) {
    if (match.tier !== "auto" || !match.entry) continue;
    const claimed = match.entry.universalParameterId ?? match.entry.id;
    const list = claimants.get(claimed);
    if (list) list.push(key);
    else claimants.set(claimed, [key]);
  }
  for (const [, keys] of claimants) {
    if (keys.length < 2) continue;
    for (const key of keys) {
      const match = matches.get(key)!;
      matches.set(key, { ...match, tier: "suggested", reason: "ambiguous" });
    }
  }
}

export function matchAllFields(
  fields: OnboardingFieldInput[],
  corpus: CorpusEntry[]
): Map<string, FieldMatch> {
  const out = new Map<string, FieldMatch>();
  for (const field of fields) {
    out.set(field.key, matchFieldToCorpus(field, corpus));
  }
  demoteCollidingMatches(out);
  return out;
}
