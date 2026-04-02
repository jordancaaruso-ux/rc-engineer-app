import "server-only";

import { createRequire } from "node:module";
import type { SetupSnapshotData } from "@/lib/runSetup";
import { getOpenAiApiKey } from "@/lib/openaiServerEnv";
import type { SetupDocumentParsedResult } from "@/lib/setupDocuments/types";
import { interpretAwesomatixSetupSnapshot } from "@/lib/setupDocuments/awesomatixImportPostProcess";
import { mappedFieldKeys } from "@/lib/setupDocuments/normalize";

const NUMERIC_HEAVY_KEYS = new Set([
  "upper_inner_shims_ff",
  "upper_inner_shims_fr",
  "upper_inner_shims_rf",
  "upper_inner_shims_rr",
  "upper_outer_shims_front",
  "upper_outer_shims_rear",
  "bump_steer_shims_front",
  "toe_gain_shims_rear",
  "under_hub_shims_front",
  "under_hub_shims_rear",
  "under_lower_arm_shims_ff",
  "under_lower_arm_shims_fr",
  "under_lower_arm_shims_rf",
  "under_lower_arm_shims_rr",
  "camber_front",
  "camber_rear",
  "caster_front",
  "caster_rear",
  "toe_front",
  "toe_rear",
  "ride_height_front",
  "ride_height_rear",
  "downstop_front",
  "downstop_rear",
  "upstop_front",
  "upstop_rear",
  "diff_oil",
  "diff_shims",
  "diff_height",
  "damper_oil_front",
  "damper_oil_rear",
  "spring_gap_front",
  "spring_gap_rear",
  "damper_percent_front",
  "damper_percent_rear",
  "spring_front",
  "spring_rear",
  "weight_balance_front_percent",
  "total_weight",
  "inner_steering_angle",
]);

function normalizeKeyText(v: string): string {
  return v
    .toLowerCase()
    .replace(/[%]/g, " percent ")
    .replace(/[().:/\\[\]_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeDecodePdfToken(token: string): string {
  try {
    return decodeURIComponent(token);
  } catch {
    return token;
  }
}

type ParserDebugHooks = {
  docId?: string;
  filename?: string;
  onStage?: (stage: string, event: "start" | "finish") => void | Promise<void>;
  onInfo?: (stage: string, data: Record<string, unknown>) => void | Promise<void>;
};

async function withStageTimeout<T>(
  stage: string,
  ms: number,
  fn: () => Promise<T>,
  dbg?: ParserDebugHooks
): Promise<T> {
  const t0 = Date.now();
  await dbg?.onStage?.(stage, "start");
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error(`Timeout after ${ms}ms (${stage})`)), ms);
    });
    const res = await Promise.race([fn(), timeout]);
    const dt = Date.now() - t0;
    await dbg?.onInfo?.(stage, { ms: dt });
    await dbg?.onStage?.(stage, "finish");
    return res;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseSimpleAwesomatixFields(text: string): SetupSnapshotData {
  const out: SetupSnapshotData = {};
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const pairRules: Array<{ key: string; left: string; right: string }> = [
    { key: "camber", left: "camber_front", right: "camber_rear" },
    { key: "caster", left: "caster_front", right: "caster_rear" },
    { key: "toe", left: "toe_front", right: "toe_rear" },
    { key: "ride height", left: "ride_height_front", right: "ride_height_rear" },
    { key: "downstop", left: "downstop_front", right: "downstop_rear" },
    { key: "upstop", left: "upstop_front", right: "upstop_rear" },
    { key: "arb", left: "arb_front", right: "arb_rear" },
    { key: "diff position", left: "diff_position_front", right: "diff_position_rear" },
    { key: "damper oil", left: "damper_oil_front", right: "damper_oil_rear" },
    { key: "spring gap", left: "spring_gap_front", right: "spring_gap_rear" },
    { key: "damper percent", left: "damper_percent_front", right: "damper_percent_rear" },
    { key: "spring", left: "spring_front", right: "spring_rear" },
    { key: "srs arrangement", left: "srs_arrangement_front", right: "srs_arrangement_rear" },
    { key: "damping", left: "damping_front", right: "damping_rear" },
    { key: "c45 installed", left: "c45_installed_front", right: "c45_installed_rear" },
    { key: "upper outer shims", left: "upper_outer_shims_front", right: "upper_outer_shims_rear" },
    { key: "under hub shims", left: "under_hub_shims_front", right: "under_hub_shims_rear" },
  ];

  const singleRules: Array<{ label: string; key: string }> = [
    { label: "bump steer shims", key: "bump_steer_shims_front" },
    { label: "toe gain shims", key: "toe_gain_shims_rear" },
    { label: "diff oil", key: "diff_oil" },
    { label: "diff shims", key: "diff_shims" },
    { label: "diff height", key: "diff_height" },
    { label: "weight balance", key: "weight_balance_front_percent" },
    { label: "total weight", key: "total_weight" },
    { label: "bodyshell", key: "bodyshell" },
    { label: "wing", key: "wing" },
    { label: "inner steering angle", key: "inner_steering_angle" },
    { label: "battery", key: "battery" },
    { label: "tires", key: "tires" },
    { label: "chassis", key: "chassis" },
    { label: "top deck front", key: "top_deck_front" },
    { label: "top deck rear", key: "top_deck_rear" },
    { label: "top deck single", key: "top_deck_single" },
    { label: "motor mount screws", key: "motor_mount_screws" },
    { label: "top deck screws", key: "top_deck_screws" },
    { label: "top deck cuts", key: "top_deck_cuts" },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1] ?? "";
    const normalized = normalizeKeyText(line);
    const normalizedNext = normalizeKeyText(nextLine);

    const cornerLabel =
      normalized.includes("upper inner shims")
        ? "upper_inner_shims"
        : normalized.includes("under lower arm shims")
          ? "under_lower_arm_shims"
          : null;
    if (cornerLabel) {
      const ff = line.match(/ff\s*[:=]?\s*([^\s,;]+)/i)?.[1] ?? "";
      const fr = line.match(/fr\s*[:=]?\s*([^\s,;]+)/i)?.[1] ?? "";
      const rf = line.match(/rf\s*[:=]?\s*([^\s,;]+)/i)?.[1] ?? "";
      const rr = line.match(/rr\s*[:=]?\s*([^\s,;]+)/i)?.[1] ?? "";
      if (ff) out[`${cornerLabel}_ff`] = ff;
      if (fr) out[`${cornerLabel}_fr`] = fr;
      if (rf) out[`${cornerLabel}_rf`] = rf;
      if (rr) out[`${cornerLabel}_rr`] = rr;
      continue;
    }

    for (const rule of pairRules) {
      if (!normalized.includes(rule.key)) continue;
      const front =
        line.match(/(?:front|f)\s*[:=]?\s*([^\s,;]+)/i)?.[1]
        ?? nextLine.match(/(?:front|f)\s*[:=]?\s*([^\s,;]+)/i)?.[1]
        ?? "";
      const rear =
        line.match(/(?:rear|r)\s*[:=]?\s*([^\s,;]+)/i)?.[1]
        ?? nextLine.match(/(?:rear|r)\s*[:=]?\s*([^\s,;]+)/i)?.[1]
        ?? "";
      if (front) out[rule.left] = front;
      if (rear) out[rule.right] = rear;
      if (!front && !rear) {
        const nums = line.match(/[-+]?\d+(?:\.\d+)?/g) ?? [];
        const numsNext = nextLine.match(/[-+]?\d+(?:\.\d+)?/g) ?? [];
        if (nums[0]) out[rule.left] = nums[0];
        if (nums[1]) out[rule.right] = nums[1];
        else if (nums[0] && numsNext[0]) {
          out[rule.left] = nums[0];
          out[rule.right] = numsNext[0];
        }
      }
    }

    for (const rule of singleRules) {
      if (!normalized.includes(rule.label) && !normalizedNext.includes(rule.label)) continue;
      const val =
        line.split(/[:=]/).slice(1).join(":").trim()
        || nextLine.split(/[:=]/).slice(1).join(":").trim();
      if (val) out[rule.key] = val;
    }
  }

  const boolKeys = ["c45_installed_front", "c45_installed_rear"] as const;
  for (const k of boolKeys) {
    const v = out[k];
    if (v == null || v === "") continue;
    const s = String(v).trim().toLowerCase();
    if (["yes", "true", "1", "on", "y"].includes(s)) out[k] = "1";
    else if (["no", "false", "0", "off", "n"].includes(s)) out[k] = "";
  }

  return out;
}

function sanitizeParsedData(raw: SetupSnapshotData): SetupSnapshotData {
  const out: SetupSnapshotData = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v == null) continue;
    const s = String(v).trim();
    if (!s) continue;
    if (NUMERIC_HEAVY_KEYS.has(k) && !/[0-9]/.test(s)) continue;
    if (s.length > 40) continue;
    out[k] = s;
  }
  return out;
}

/**
 * Last-resort token heuristics. Do not map AM-prefixed or ST-prefixed part tokens to oil/spring — use PDF form import.
 */
function parseFromTokenStream(extractedText: string): SetupSnapshotData {
  const out: SetupSnapshotData = {};
  const tokens = extractedText
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/[^\w%+\-/.]/g, ""));

  const pct = tokens.filter((t) => /^\d{1,3}%$/.test(t));
  for (const p of pct) {
    const n = parseInt(p.replace("%", ""), 10);
    if (!Number.isFinite(n) || n < 50 || n > 100) continue;
    if (out.damper_percent_front == null) out.damper_percent_front = String(n);
    else if (out.damper_percent_rear == null) out.damper_percent_rear = String(n);
  }

  return out;
}

async function extractPdfText(file: File): Promise<string> {
  const require = createRequire(import.meta.url);
  const PDFParser = require("pdf2json") as new () => {
    on: (event: string, cb: (arg: unknown) => void) => void;
    parseBuffer: (buffer: Buffer) => void;
  };
  const buffer = Buffer.from(await file.arrayBuffer());
  const text = await new Promise<string>((resolve, reject) => {
    const parser = new PDFParser();
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    parser.on("pdfParser_dataError", (err: unknown) => {
      const msg =
        err && typeof err === "object" && "parserError" in err
          ? String((err as { parserError?: unknown }).parserError)
          : "PDF parsing failed";
      settle(() => reject(new Error(msg)));
    });
    parser.on("pdfParser_dataReady", (data: unknown) => {
      if (!(data && typeof data === "object" && "Pages" in data)) {
        settle(() => reject(new Error("Malformed PDF structure: missing Pages")));
        return;
      }
      const pages = ((data as { Pages?: Array<{ Texts?: Array<{ R?: Array<{ T?: string }> }> }> }).Pages ?? []);
      if (!Array.isArray(pages)) {
        settle(() => reject(new Error("Malformed PDF structure: Pages is not an array")));
        return;
      }
      const all = pages
        .flatMap((p) => p.Texts ?? [])
        .flatMap((t) => t.R ?? [])
        .map((r) => safeDecodePdfToken(r.T ?? ""))
        .join("\n");
      settle(() => resolve(all.trim()));
    });
    try {
      parser.parseBuffer(buffer);
    } catch (e) {
      settle(() => reject(e instanceof Error ? e : new Error(String(e))));
    }
  });
  return text;
}

async function extractImageTextWithOpenAi(file: File): Promise<string | null> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return null;
  const mime = file.type || "image/jpeg";
  const buf = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: controller.signal,
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "Extract setup sheet text from this image. Return plain text only. Keep line structure where possible.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract all visible setup sheet text." },
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          ],
        },
      ],
    }),
  });
  clearTimeout(timeoutId);
  const json = (await res.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (!res.ok) return null;
  return json.choices?.[0]?.message?.content?.trim() ?? null;
}

export async function parseSetupDocumentFile(input: {
  file: File;
  sourceType: "PDF" | "IMAGE";
  debug?: ParserDebugHooks;
}): Promise<SetupDocumentParsedResult> {
  try {
    const fileMeta = {
      name: input.file.name,
      size: input.file.size,
      mimeType: input.file.type,
      sourceType: input.sourceType,
    };
    await input.debug?.onInfo?.("meta", fileMeta);

    const extractedText =
      input.sourceType === "PDF"
        ? await withStageTimeout("pdf_text_extract_started", 9000, async () => extractPdfText(input.file), input.debug)
        : await withStageTimeout("image_ocr_started", 20000, async () => extractImageTextWithOpenAi(input.file), input.debug);
    await input.debug?.onInfo?.("text_extract_completed", { length: (extractedText ?? "").length });

    if (!extractedText || extractedText.trim() === "") {
      return {
        parserType: "awesomatix_v1",
        parseStatus: "FAILED",
        extractedText: extractedText ?? null,
        parsedData: {},
        note:
          input.sourceType === "IMAGE"
            ? "Stored image. No OCR text extracted yet (configure OPENAI_API_KEY for image extraction)."
            : "Stored PDF, but text extraction returned empty.",
        mappedFieldKeys: [],
        mappedFieldCount: 0,
      };
    }

    const primaryParsed = await withStageTimeout(
      "raw_parse_primary_started",
      4000,
      async () =>
        interpretAwesomatixSetupSnapshot(
          sanitizeParsedData(parseSimpleAwesomatixFields(extractedText))
        ),
      input.debug
    );
    const fallbackParsed = await withStageTimeout(
      "raw_parse_fallback_started",
      2000,
      async () =>
        interpretAwesomatixSetupSnapshot(
          sanitizeParsedData(parseFromTokenStream(extractedText))
        ),
      input.debug
    );
    const parsedData =
      Object.keys(primaryParsed).length > 0
        ? primaryParsed
        : fallbackParsed;
    const keys = mappedFieldKeys(parsedData);
    const parsedCount = keys.length;
    await input.debug?.onInfo?.("raw_parse_completed", { parsedCount, parsedKeysSample: keys.slice(0, 25) });

    const parseStatus =
      parsedCount >= 10
        ? "PARSED"
        : parsedCount > 0
          ? "PARTIAL"
          : extractedText.length > 0
            ? "PARTIAL"
            : "FAILED";
    return {
      parserType: "awesomatix_v1",
      parseStatus,
      extractedText,
      parsedData,
      note: parsedCount > 0 ? null : "Text extracted, but mapping confidence is low.",
      mappedFieldKeys: keys,
      mappedFieldCount: parsedCount,
    };
  } catch (err) {
    return {
      parserType: "awesomatix_v1",
      parseStatus: "FAILED",
      extractedText: null,
      parsedData: {},
      note: err instanceof Error ? err.message : "Parser failed",
      mappedFieldKeys: [],
      mappedFieldCount: 0,
    };
  }
}

