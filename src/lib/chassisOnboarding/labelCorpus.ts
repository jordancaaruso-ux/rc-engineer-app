import { buildGenericPresetSchema } from "@/lib/setupSheetModels/genericPresetSchema";
import { buildA800SeedSchema } from "@/lib/setupSheetModels/seedA800Model";
import type { SetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { UNIVERSAL_TOURING_PARAMETERS } from "@/lib/setupSheetModels/universalParameters";
import type { CustomFieldUiType, CustomFieldValueType } from "@/lib/setupCalibrations/types";

/**
 * The vocabulary of parameter names this app is willing to ship — every label already reviewed and
 * published by the founder, in one list.
 *
 * This exists because of a specific past failure: an AI pass that *invented* schema labels for a
 * new chassis was deleted after review cost more than hand-authoring (SETUP_UPLOAD_NORTH_STAR.md,
 * 2026-07-22). Onboarding therefore never generates a name. It only ever answers "which of these
 * approved labels is this PDF field?", and anything it can't answer goes to a human. A wrong match
 * is one visibly odd row; an invented name is a new vocabulary the founder has to police forever.
 */

export type CorpusSource = "universal" | "authorizedModel" | "generic";

export type CorpusEntry = {
  /** Stable, e.g. "universal:camber_front" | "model:awesomatix_a800rr:srs_front". */
  id: string;
  /** The founder-approved label, verbatim. Never synthesized here. */
  displayLabel: string;
  universalParameterId?: string;
  valueType?: CustomFieldValueType;
  uiType?: CustomFieldUiType;
  unit?: string;
  /** Option labels this concept already ships with, as a pick-list seed. */
  optionLabels?: string[];
  source: CorpusSource;
  /** Normalized tokens matched against a PDF field name. Built by `corpusMatchTokens`. */
  tokens: string[][];
};

/**
 * Split into comparable tokens: "fr-shock-oil" and "Shock oil (Front)" must land on common ground.
 *
 * Letter/digit boundaries split too, so an Acrobat default name ("Text47") separates into a stop
 * word and a bare number and correctly ends up carrying no meaning at all.
 */
export function normalizeToTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Sheet shorthand → the word it means, so a PDF's `re-shock-oil` and a label's "(Rear)" compare.
 *
 * `fr`, `rr`, `f` and `r` are deliberately NOT expanded. Xray writes `fr-` for front, but the app's
 * own four-point link keys use `_fr` for the front bulkhead's REAR pickup and `_rr` for the rear
 * bulkhead's rear pickup — expanding them made `fr-shims` and `upper_inner_shims_fr` agree for the
 * wrong reason, and would eventually cross a front reading into a rear stat. Left unexpanded they
 * still match each other literally, which is all that is needed. Xray's `fr-camber` style names
 * resolve through the registry resolver instead, which reads the prefix in context.
 */
const TOKEN_SYNONYMS: Record<string, string> = {
  frt: "front",
  front: "front",
  re: "rear",
  rear: "rear",
  ht: "height",
  hgt: "height",
  rh: "rideheight",
  castor: "caster",
  shock: "damper",
  oil: "oil",
  bar: "bar",
  arb: "antirollbar",
  swaybar: "antirollbar",
  rollbar: "antirollbar",
  tyre: "tire",
  tyres: "tire",
  tires: "tire",
  wt: "weight",
  deg: "",
  mm: "",
  cst: "",
  the: "",
};

/**
 * Tokens carrying no discriminating meaning — dropping them stops "setup"/"value" driving a match.
 *
 * The second group is the tell for a sheet whose field names were never authored: Acrobat's own
 * defaults ("Text47", "Check Box11"). Stripping them leaves such a field with zero tokens, which
 * `matchFields` reports as an opaque name rather than pretending to a weak match.
 */
const STOP_TOKENS = new Set([
  "",
  "setup",
  "set",
  "up",
  "value",
  "pos",
  "position",
  "no",
  "nr",
  "num",
  "text",
  "txt",
  "check",
  "checkbox",
  "box",
  "field",
  "untitled",
  "undefined",
  "liste",
  "deroulante",
]);

export function canonicalizeTokens(tokens: string[]): string[] {
  const out: string[] = [];
  for (const raw of tokens) {
    const mapped = TOKEN_SYNONYMS[raw] ?? raw;
    if (STOP_TOKENS.has(mapped)) continue;
    // Digits alone ("topdeck-flex01" → "01") identify a box within a group, not the concept.
    if (/^\d+$/.test(mapped)) continue;
    out.push(mapped);
  }
  return out;
}

export function corpusMatchTokens(text: string): string[] {
  return canonicalizeTokens(normalizeToTokens(text));
}

/**
 * Where on the car, not what the part is. These agree between almost any two parameters, so a match
 * resting on them alone is no match: "fr-rebound" and "Toe (Front)" share a side and nothing else.
 */
const POSITIONAL_TOKENS = new Set(["front", "rear", "ff", "fr", "rf", "rr", "left", "right"]);

export function isPositionalToken(token: string): boolean {
  return POSITIONAL_TOKENS.has(token);
}

function addEntry(
  into: Map<string, CorpusEntry>,
  entry: Omit<CorpusEntry, "tokens"> & { tokenSources: string[] }
): void {
  // Dedupe on the label itself: the same concept reached from the registry and from a shipped
  // schema is one vocabulary item, and the earlier (higher-precedence) source keeps the entry.
  const dedupeKey = entry.displayLabel.trim().toLowerCase();
  if (into.has(dedupeKey)) return;
  const tokens = entry.tokenSources
    .map((s) => corpusMatchTokens(s))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return;
  const { tokenSources: _ignored, ...rest } = entry;
  into.set(dedupeKey, { ...rest, tokens });
}

/** Turn already-published chassis schemas into corpus entries. Pure — the DB read lives elsewhere. */
export function corpusEntriesFromSchemas(
  schemas: Array<{ slug: string; schema: SetupSheetModelSchema; source?: CorpusSource }>,
  into: Map<string, CorpusEntry>
): void {
  for (const { slug, schema, source } of schemas) {
    for (const field of schema.fields) {
      addEntry(into, {
        id: `model:${slug}:${field.key}`,
        displayLabel: field.displayLabel,
        universalParameterId: field.universalParameterId,
        valueType: field.valueType,
        uiType: field.uiType,
        unit: field.unit,
        optionLabels: field.groupedOptionLabels,
        source: source ?? "authorizedModel",
        tokenSources: [field.key, field.displayLabel],
      });
    }
  }
}

/**
 * The corpus available without touching the database: the universal registry, the generic touring
 * preset, and the one bespoke schema that ships in code (A800RR). Precedence is deliberate —
 * registry labels win, because they are the ids that pool cars in community statistics.
 */
export function buildStaticLabelCorpus(): CorpusEntry[] {
  const byLabel = new Map<string, CorpusEntry>();

  for (const def of UNIVERSAL_TOURING_PARAMETERS) {
    addEntry(byLabel, {
      id: `universal:${def.id}`,
      displayLabel: def.label,
      universalParameterId: def.id,
      source: "universal",
      tokenSources: [def.id, def.label, ...def.aliases],
    });
  }

  corpusEntriesFromSchemas(
    [
      { slug: "generic", schema: buildGenericPresetSchema("Generic touring"), source: "generic" },
      { slug: "awesomatix_a800rr", schema: buildA800SeedSchema(), source: "authorizedModel" },
    ],
    byLabel
  );

  return [...byLabel.values()];
}

/**
 * Full corpus: the static sources plus every authorized chassis schema already in the catalog, so
 * each onboarded car widens the vocabulary the next one is matched against.
 */
export function buildLabelCorpus(
  authorizedSchemas: Array<{ slug: string; schema: SetupSheetModelSchema }>
): CorpusEntry[] {
  const byLabel = new Map<string, CorpusEntry>();
  for (const entry of buildStaticLabelCorpus()) {
    byLabel.set(entry.displayLabel.trim().toLowerCase(), entry);
  }
  corpusEntriesFromSchemas(authorizedSchemas, byLabel);
  return [...byLabel.values()];
}
