import { suggestUniversalParameterId, universalParameterCatalogForPrompt } from "@/lib/setupSheetModels/matchUniversalParameter";
import { buildImageTiles } from "@/lib/setupExtractAi/extractSetupFromImage";

/**
 * Stage 1.5 (SETUP_UPLOAD_NORTH_STAR.md): draft a setup-sheet field schema for a brand-new
 * car by reading its sheet's printed layout (labels + sections + which rows are choices).
 * This is the "create a new car" path — the user gets a provisional private car immediately;
 * admin later reviews/promotes the schema to shared/global.
 *
 * Universal-parameter mapping is mandatory: the drafter is given the canonical registry and
 * told to reuse those ids for cross-car concepts, and `suggestUniversalParameterId` is run as
 * a backstop so the new car still pools into community aggregations.
 *
 * No "server-only" import (API key is a parameter) so the eval/scripts can exercise it.
 */

export type DraftedField = {
  key: string;
  displayLabel: string;
  section: string;
  valueType: "text" | "choice";
  options?: string[];
  universalParameterId?: string;
};

export type DraftedSchema = {
  version: 1;
  carName: string;
  fields: DraftedField[];
  /** Fields where the drafter proposed a universal id vs the backstop filled/changed it. */
  universalMappedCount: number;
  model: string;
  warnings: string[];
};

export const DEFAULT_SCHEMA_DRAFT_MODEL = "gpt-4o";

function buildSystemPrompt(): string {
  const registry = universalParameterCatalogForPrompt()
    .map((p) => `  ${p.id} — ${p.label}`)
    .join("\n");
  return `You are cataloguing the FIELDS on a blank/filled RC touring-car setup sheet to build a reusable schema for that car. Read the PRINTED template — every labelled input box, checkbox group, and section heading — and list each field once. Ignore any handwritten/filled-in values; you are mapping the form, not reading a driver's setup.

For each field return:
- key: a stable snake_case identifier you invent from the label (e.g. "ride_height_front", "front_shock_position"). Front/rear or corner (FF/FR/RF/RR) must be reflected in the key.
- displayLabel: a label a driver can understand WITHOUT seeing the sheet. Sheets often print generic
  words ("HEIGHT", "SHIM", "SIZE", "POSITION") whose meaning comes from where the box sits in a
  technical drawing — for those, describe what the dimension/choice actually is from the diagram
  context (e.g. "Steering block height (mm)" or "Upper mount shim — caster block (mm)"), never a bare
  "Height (Front)". Labels that are already self-explanatory are kept as printed, with unit if shown.
  A bare generic word plus a section ("Shim (Front)") is NOT acceptable: follow the arrow/leader line
  from the box into the drawing and name the part it points at ("Rear hub shim (mm)", "Upper arm
  mount shim — front suspension (mm)"); if genuinely unresolvable, name its visual position ("Shim —
  front suspension diagram, upper right (mm)") so a human reviewer can find and rename it.
- section: the sheet section heading it sits under (e.g. "Front suspension", "Shocks", "Top view").
- valueType: "choice" if the driver picks from printed options / ticks a box; "text" for a written number or free text.
- options: for "choice" only — the exact printed option labels (e.g. ["Graphite","Alu","Alu flex"], ["yes","no"], ["1","2","3","4"]).
- universalParameterId: REQUIRED when the field is one of these canonical cross-car concepts (reuse the id EXACTLY so the car pools into shared stats); omit for car-specific fields.

Canonical universal parameters:
${registry}

Return JSON: {"fields": [{"key","displayLabel","section","valueType","options"?,"universalParameterId"?}, ...]} covering every field on the sheet.`;
}

async function runDraftPass(input: {
  apiKey: string;
  model: string;
  imageDataUrls: string[];
  carName: string;
}): Promise<DraftedField[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000);
  let raw: unknown;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: input.model,
        temperature: 0,
        max_tokens: 8192,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildSystemPrompt() },
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  `Car: ${input.carName}. Catalogue every field on this setup sheet. `
                  + `Image 1 is the full sheet; the rest are zoomed tiles (top-left, top-right, `
                  + `bottom-left, bottom-right, with overlap) — read small printed labels from the tiles.`,
              },
              ...input.imageDataUrls.map((url) => ({
                type: "image_url" as const,
                image_url: { url, detail: "high" as const },
              })),
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Schema draft failed: ${res.status} ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    raw = JSON.parse(json.choices?.[0]?.message?.content?.trim() ?? "{}");
  } finally {
    clearTimeout(timeoutId);
  }

  const rawFields = Array.isArray((raw as { fields?: unknown })?.fields) ? (raw as { fields: unknown[] }).fields : [];
  const fields: DraftedField[] = [];
  const seenKeys = new Set<string>();
  for (const item of rawFields) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    let key = typeof f.key === "string" ? f.key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") : "";
    if (!key) continue;
    while (seenKeys.has(key)) key = `${key}_2`;
    seenKeys.add(key);
    const displayLabel = typeof f.displayLabel === "string" && f.displayLabel.trim() ? f.displayLabel.trim() : key;
    const section = typeof f.section === "string" ? f.section.trim() : "";
    const valueType = f.valueType === "choice" ? "choice" : "text";
    const options = Array.isArray(f.options)
      ? f.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0).map((o) => o.trim())
      : undefined;
    // Trust the drafter's universal id, but always run the backstop so a missed/novel field
    // still maps — the whole point is the new car can't silently fall out of aggregations.
    const proposed = typeof f.universalParameterId === "string" ? f.universalParameterId.trim() : "";
    const universalParameterId = proposed || suggestUniversalParameterId(key, displayLabel);
    fields.push({
      key,
      displayLabel,
      section,
      valueType: valueType === "choice" && options && options.length > 0 ? "choice" : "text",
      ...(valueType === "choice" && options && options.length > 0 ? { options } : {}),
      ...(universalParameterId ? { universalParameterId } : {}),
    });
  }
  return fields;
}

/** Same concept drafted under different keys ("front_shim" vs "shim_front") dedupes by token set. */
function keySignature(key: string): string {
  return key.split("_").filter(Boolean).sort().join("|");
}

/** A label whose substance is just a generic word ("Shim (Front) (mm)") tells a driver nothing. */
const GENERIC_LABEL_RE = /^(height|shim|size|position|length|width|offset)\s*(\(|—|-|,|$)/i;

/** Prefer the richer version of a field: universal mapping > non-generic label > options > longer label. */
function richerField(a: DraftedField, b: DraftedField): DraftedField {
  if (Boolean(a.universalParameterId) !== Boolean(b.universalParameterId)) {
    return a.universalParameterId ? a : b;
  }
  const aGeneric = GENERIC_LABEL_RE.test(a.displayLabel);
  const bGeneric = GENERIC_LABEL_RE.test(b.displayLabel);
  if (aGeneric !== bGeneric) return aGeneric ? b : a;
  const aOpts = a.options?.length ?? 0;
  const bOpts = b.options?.length ?? 0;
  if (aOpts !== bOpts) return aOpts > bOpts ? a : b;
  return a.displayLabel.length >= b.displayLabel.length ? a : b;
}

function unionDraftedFields(passA: DraftedField[], passB: DraftedField[]): DraftedField[] {
  const bySig = new Map<string, DraftedField>();
  const order: string[] = [];
  for (const f of [...passA, ...passB]) {
    const sig = keySignature(f.key);
    const existing = bySig.get(sig);
    if (!existing) {
      bySig.set(sig, f);
      order.push(sig);
    } else {
      bySig.set(sig, richerField(existing, f));
    }
  }
  return order.map((sig) => bySig.get(sig)!);
}

export async function draftSetupSheetModelSchema(input: {
  apiKey: string;
  imageBytes: Buffer;
  imageMime: "image/png" | "image/jpeg";
  carName: string;
  model?: string;
}): Promise<DraftedSchema> {
  const model = input.model?.trim() || DEFAULT_SCHEMA_DRAFT_MODEL;
  const warnings: string[] = [];

  // Full sheet + 2×2 zoomed tiles — the same fidelity trick that fixed value extraction
  // (small printed labels blur when OpenAI downscales the full page).
  const imageDataUrls = [`data:${input.imageMime};base64,${input.imageBytes.toString("base64")}`];
  try {
    for (const t of await buildImageTiles(input.imageBytes)) {
      imageDataUrls.push(`data:image/png;base64,${t.toString("base64")}`);
    }
  } catch {
    warnings.push("tiling_failed_full_image_only");
  }

  // Two passes, unioned: a single pass misses a handful of fields nondeterministically
  // (observed 68–79 on the same sheet); the union is stable and complete.
  const [passA, passB] = await Promise.all([
    runDraftPass({ apiKey: input.apiKey, model, imageDataUrls, carName: input.carName }),
    runDraftPass({ apiKey: input.apiKey, model, imageDataUrls, carName: input.carName }),
  ]);
  const fields = unionDraftedFields(passA, passB);
  const universalMappedCount = fields.filter((f) => f.universalParameterId).length;
  if (fields.length === 0) warnings.push("no_fields_drafted");

  return { version: 1, carName: input.carName, fields, universalMappedCount, model, warnings };
}
