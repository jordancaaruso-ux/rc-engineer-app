import sharp from "sharp";

import {
  type ExtractionFieldDef,
  type ExtractionSchema,
  type ExtractedFieldValue,
  type SetupSheetAiExtraction,
} from "@/lib/setupExtractAi/types";
import { extractedValuesMatch } from "@/lib/setupExtractAi/normalizeExtractedValue";

/**
 * Full-page vision extraction of a setup sheet image against an extraction schema.
 * Stage 1 of SETUP_UPLOAD_NORTH_STAR.md: runs when no calibration matches a document.
 *
 * Dual-pass: the same request runs twice with the field list in different order.
 * Agreement is the confidence signal — matching values keep the model's confidence,
 * disagreeing values are forced under the flag threshold so review always sees them.
 *
 * No "server-only" import: the eval harness (scripts/setup-extract-eval) runs this
 * under plain tsx. API key is a parameter, never read from env here.
 */

const OPENAI_TIMEOUT_MS = 480000;
const DISAGREEMENT_CONFIDENCE = 0.4;

/**
 * Eval-picked defaults (scripts/setup-extract-eval, 2026-07-06): gpt-5 pass A +
 * gpt-4o pass B scored 97.5% correct-or-flagged with the fewest confident mistakes —
 * cross-model disagreement is what pushes shared checkbox misreads into review.
 */
export const DEFAULT_SETUP_EXTRACT_MODEL = "gpt-5";
export const DEFAULT_SETUP_EXTRACT_MODEL_B = "gpt-4o";

type PassResult = Map<string, { value: string; confidence: number }>;

/** GPT-5 / o-series reject custom temperature and use max_completion_tokens. */
function modelUsesDefaultSampler(model: string): boolean {
  const m = model.trim().toLowerCase();
  return m.startsWith("gpt-5") || /^o[0-9]/.test(m);
}

/**
 * OpenAI vision downscales large images until small checkbox marks blur; the baseline
 * eval's dominant failure was misread checkbox groups. Alongside the full-sheet
 * overview we send 2×2 zoomed tiles (with overlap) so every mark arrives legible.
 */
export async function buildImageTiles(imageBytes: Buffer): Promise<Buffer[]> {
  const meta = await sharp(imageBytes).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) return [];
  const overlapX = Math.round(w * 0.04);
  const overlapY = Math.round(h * 0.04);
  const midX = Math.round(w / 2);
  const midY = Math.round(h / 2);
  const regions = [
    { left: 0, top: 0, width: midX + overlapX, height: midY + overlapY },
    { left: midX - overlapX, top: 0, width: w - midX + overlapX, height: midY + overlapY },
    { left: 0, top: midY - overlapY, width: midX + overlapX, height: h - midY + overlapY },
    { left: midX - overlapX, top: midY - overlapY, width: w - midX + overlapX, height: h - midY + overlapY },
  ];
  const tiles: Buffer[] = [];
  for (const r of regions) {
    tiles.push(await sharp(imageBytes).extract(r).png().toBuffer());
  }
  return tiles;
}

function buildFieldCatalogLines(fields: ExtractionFieldDef[]): string[] {
  const bySection = new Map<string, ExtractionFieldDef[]>();
  for (const f of fields) {
    const list = bySection.get(f.section) ?? [];
    list.push(f);
    bySection.set(f.section, list);
  }
  const lines: string[] = [];
  for (const [section, sectionFields] of bySection) {
    lines.push(`## ${section}`);
    for (const f of sectionFields) {
      const opts = f.options?.length ? ` — options: ${f.options.join(" | ")}` : "";
      lines.push(`- ${f.key}: "${f.label}"${opts}`);
    }
  }
  return lines;
}

const SYSTEM_PROMPT = `You are transcribing a filled-in RC touring car setup sheet from an image. You are given a catalog of fields (key, printed label, and for choice fields the allowed options). Read the sheet and return the value written or marked for each field.

Rules:
- Transcribe EXACTLY what is written. Do not correct, infer, or guess values.
- A field left blank on the sheet is "" (empty string). Blank is a normal, common answer — never invent a value for an empty box.
- Filled values are red; the sheet's printed template is black. A box showing only black print holds no value.
- Values are often handwritten-style red or blue text inside boxes, or red X marks in checkboxes, and may sit inside technical diagrams.
- Corner/axle qualifiers matter: front vs rear, FF/FR/RF/RR, left vs right. Match the field to the correct position on the sheet.
- confidence: your honest probability (0..1) that the value you report is exactly right. Use low confidence (<0.6) when marks are ambiguous, print is tiny, or you are unsure which box a value belongs to. Never report high confidence on a guess.

CHOICE FIELDS (fields that list options) — read these in two explicit steps:
1. "marked": look at the group's boxes and decide whether ANY box actually contains a red X / cross / filled dot. Answer true only if you can point to a specific marked box; answer false if every box is empty.
2. "value": if marked is true, the option whose box holds the mark; if marked is false, "".
- Do NOT default. An unmarked group is very common and MUST be marked:false + value:"". Never fall back to the first option, the most common option, or a plausible default like "standard", "none", "alu", "yes", or "servo horn" just because a value seems expected. Only a mark you can actually see justifies a non-empty value.
- The option WORDS themselves ("NONE", "BEARING", "COMPOSITE", "ALU", "STANDARD", "YES", "NO", "HARD", "MEDIUM", "SERVO HORN"...) are PRINTED black labels that are ALWAYS on the sheet next to their empty box, whether or not that option is chosen. Reading the printed word is NOT a mark. A mark is a separate red X / cross / filled dot placed INTO one of the boxes. If you only see the printed words and no red mark in any box, that group is marked:false + value:"".

Return ONLY a JSON object: {"fields": [{"key": string, "value": string, "confidence": number, "marked": boolean}, ...]} covering EVERY key in the catalog exactly once. "marked" is required for choice fields and may be omitted for free-text fields.`;

async function runExtractionPass(input: {
  apiKey: string;
  model: string;
  imageDataUrls: string[];
  fields: ExtractionFieldDef[];
  sheetLabel: string;
  choiceKeys: Set<string>;
}): Promise<PassResult> {
  const catalog = buildFieldCatalogLines(input.fields).join("\n");
  // Transcription needs perception, not deliberation — low reasoning effort keeps
  // GPT-5-family latency and cost sane without hurting read accuracy.
  const tokenCap = modelUsesDefaultSampler(input.model)
    ? { max_completion_tokens: 16384, reasoning_effort: "low" }
    : { temperature: 0, max_tokens: 8192 };
  const maxAttempts = 5;
  for (let attempt = 1; ; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: input.model,
        ...tokenCap,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  `Sheet type: ${input.sheetLabel}\n\n`
                  + `Image 1 is the full sheet. The following images are zoomed tiles of the same sheet `
                  + `(top-left, top-right, bottom-left, bottom-right, with overlap) — read small values and `
                  + `checkbox marks from the tiles, and use the full sheet for overall layout.\n\n`
                  + `Field catalog (${input.fields.length} fields):\n${catalog}\n\nReturn the JSON object now.`,
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
      if (res.status === 429 && attempt < maxAttempts) {
        const body = await res.text().catch(() => "");
        const hinted = Number(/try again in ([0-9.]+)s/i.exec(body)?.[1]);
        const waitMs = Number.isFinite(hinted) && hinted > 0
          ? Math.ceil(hinted * 1000) + 500
          : 2000 * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`OpenAI extraction failed: ${res.status} ${body.slice(0, 300)}`);
      }
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = json.choices?.[0]?.message?.content?.trim() ?? "";
      const parsed = JSON.parse(content) as { fields?: unknown };
      const out: PassResult = new Map();
      if (Array.isArray(parsed.fields)) {
        for (const item of parsed.fields) {
          if (!item || typeof item !== "object") continue;
          const f = item as Record<string, unknown>;
          const key = typeof f.key === "string" ? f.key : "";
          if (!key || out.has(key)) continue;
          let value = typeof f.value === "string" ? f.value.trim() : f.value == null ? "" : String(f.value).trim();
          // Enforce the two-step choice contract: no visible mark ⇒ empty, in code,
          // so a model's default-filling instinct cannot ship a phantom option.
          if (input.choiceKeys.has(key) && f.marked === false) value = "";
          const confRaw = typeof f.confidence === "number" ? f.confidence : 0;
          const confidence = Math.max(0, Math.min(1, confRaw));
          out.set(key, { value, confidence });
        }
      }
      return out;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export async function extractSetupFromImage(input: {
  apiKey: string;
  imageBytes: Buffer;
  imageMime: "image/png" | "image/jpeg";
  schema: ExtractionSchema;
  model?: string;
  /**
   * Model for the second pass. A *different* model decorrelates checkbox misreads —
   * same-model dual-pass tends to agree confidently on the same wrong box.
   */
  modelB?: string;
  /** 1 = single pass (cheaper, weaker confidence signal). Default 2. */
  passes?: 1 | 2;
}): Promise<SetupSheetAiExtraction> {
  const model = input.model?.trim() || DEFAULT_SETUP_EXTRACT_MODEL;
  const modelB = input.modelB?.trim() || DEFAULT_SETUP_EXTRACT_MODEL_B;
  const passes = input.passes ?? 2;
  const warnings: string[] = [];
  const fullDataUrl = `data:${input.imageMime};base64,${input.imageBytes.toString("base64")}`;
  let tileDataUrls: string[] = [];
  try {
    tileDataUrls = (await buildImageTiles(input.imageBytes)).map(
      (t) => `data:image/png;base64,${t.toString("base64")}`
    );
  } catch {
    warnings.push("tiling_failed_full_image_only");
  }
  const imageDataUrls = [fullDataUrl, ...tileDataUrls];

  const choiceKeys = new Set(input.schema.fields.filter((f) => f.valueType === "choice").map((f) => f.key));
  const passInputs = [
    { fields: input.schema.fields, passModel: model },
    // Pass B walks the catalog in reverse order (and ideally a different model) to decorrelate errors.
    { fields: [...input.schema.fields].reverse(), passModel: modelB },
  ].slice(0, passes);

  // Parallel passes halve wall time; TPM bursts are absorbed by the 429 retry-with-backoff
  // inside runExtractionPass (the reason this was once sequential).
  const results: PassResult[] = await Promise.all(
    passInputs.map((pass) =>
      runExtractionPass({
        apiKey: input.apiKey,
        model: pass.passModel,
        imageDataUrls,
        fields: pass.fields,
        sheetLabel: input.schema.label,
        choiceKeys,
      })
    )
  );

  const primary = results[0];
  const secondary = results.length > 1 ? results[1] : null;

  const fields: ExtractedFieldValue[] = [];
  for (const def of input.schema.fields) {
    const a = primary.get(def.key);
    const b = secondary?.get(def.key) ?? null;
    if (!a && !b) {
      warnings.push(`missing_key:${def.key}`);
      fields.push({ key: def.key, value: "", confidence: 0 });
      continue;
    }
    if (!secondary) {
      const single = a ?? b!;
      fields.push({ key: def.key, value: single.value, confidence: single.confidence });
      continue;
    }
    if (!a || !b) {
      // One pass dropped the key — treat as disagreement.
      const present = (a ?? b)!;
      fields.push({
        key: def.key,
        value: present.value,
        confidence: Math.min(present.confidence, DISAGREEMENT_CONFIDENCE),
      });
      continue;
    }
    if (extractedValuesMatch(a.value, b.value)) {
      fields.push({ key: def.key, value: a.value, confidence: Math.min(a.confidence, b.confidence) });
    } else {
      const winner = a.confidence >= b.confidence ? a : b;
      const loser = winner === a ? b : a;
      fields.push({
        key: def.key,
        value: winner.value,
        confidence: DISAGREEMENT_CONFIDENCE,
        disagreementValue: loser.value,
      });
    }
  }

  return {
    version: 1,
    model: modelB !== model ? `${model}+${modelB}` : model,
    schemaLabel: input.schema.label,
    fields,
    passCount: results.length,
    warnings,
  };
}
