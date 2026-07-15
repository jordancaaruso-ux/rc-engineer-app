import "server-only";

import path from "node:path";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import * as ort from "onnxruntime-node";

/**
 * Local, offline text recognition for calibration crops — PP-OCRv4 (RapidOCR) recognition model
 * run in-process via onnxruntime-node. Replaces the slow cloud consensus OCR on the advice path:
 * ~3s for a full sheet vs 40-210s, no OpenAI quota/latency dependency. Detection is NOT needed —
 * the calibration gives exact per-field boxes, so we only recognize known crops.
 *
 * The recognition model + its char dictionary ship in ./models and are traced into the serverless
 * function via `outputFileTracingIncludes` in next.config. Loading is lazy + cached across
 * invocations; a load failure degrades gracefully (empty result → caller keeps its fallback).
 *
 * Model = PP-OCRv3 ENGLISH rec (latin + digits + punctuation). Chosen over the multilingual ch v4
 * model because ch drops small decimal points on repeated digits (5.5→"55", 2.2→"22") — a
 * confident-wrong failure on setup NUMBERS, which are what matter. The en model reads those
 * correctly; it's slightly weaker on prose names, but those are metadata and the confidence flag
 * catches them.
 */

const MODEL_PATH = path.join(process.cwd(), "src/lib/setupCalibrations/models/ppocrv3-en-rec.onnx");
const DICT_PATH = path.join(process.cwd(), "src/lib/setupCalibrations/models/en_dict.txt");

// Below this confidence a read is flagged for review rather than trusted silently (the driver's
// "glance-review the uncertain ones" bar). Empty reads always flag.
const CONFIDENCE_FLAG_THRESHOLD = 0.6;

export type LocalOcrRequest = { key: string; cropPng: Buffer; numericOnly: boolean };
export type LocalOcrResult = {
  values: Record<string, string>;
  confidence: Record<string, number>;
  /** Keys whose read was empty or low-confidence — surface for a glance instead of trusting. */
  flaggedKeys: string[];
  /** True when the model was unavailable (caller should fall back). */
  unavailable: boolean;
};

let sessionPromise: Promise<ort.InferenceSession> | null = null;
let labels: string[] | null = null;

function loadLabels(): string[] {
  if (labels) return labels;
  const lines = readFileSync(DICT_PATH, "utf8").replace(/\r/g, "").split("\n");
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  // PaddleOCR label list = [blank] + dict lines + [space] (use_space_char=True on v4 rec).
  labels = ["<blank>", ...lines, " "];
  return labels;
}

function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(MODEL_PATH).catch((e) => {
      sessionPromise = null; // allow retry on a later request
      throw e;
    });
  }
  return sessionPromise;
}

/** PP-OCR rec preprocessing: RGB, fixed height 48, keep aspect, normalize to [-1,1], CHW tensor. */
async function toTensor(cropPng: Buffer): Promise<ort.Tensor> {
  const meta = await sharp(cropPng).metadata();
  const H = 48;
  const W = Math.max(16, Math.min(1200, Math.round((H * (meta.width ?? 1)) / (meta.height ?? 1))));
  const { data } = await sharp(cropPng).removeAlpha().resize({ width: W, height: H, fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const chw = new Float32Array(3 * H * W);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 3;
      for (let c = 0; c < 3; c++) chw[c * H * W + y * W + x] = (data[p + c]! / 255 - 0.5) / 0.5;
    }
  }
  return new ort.Tensor("float32", chw, [1, 3, H, W]);
}

/** Greedy CTC decode of the rec output [1, T, C] → text + mean per-step confidence. */
function ctcDecode(out: ort.Tensor, chars: string[]): { text: string; conf: number } {
  const [, T, C] = out.dims as number[];
  const d = out.data as Float32Array;
  const picked: string[] = [];
  const confs: number[] = [];
  let prev = -1;
  for (let t = 0; t < T!; t++) {
    let best = 0;
    let bestv = -Infinity;
    for (let c = 0; c < C!; c++) {
      const v = d[t * C! + c]!;
      if (v > bestv) { bestv = v; best = c; }
    }
    if (best !== 0 && best !== prev) { picked.push(chars[best] ?? ""); confs.push(bestv); }
    prev = best;
  }
  const conf = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
  return { text: picked.join("").replace(/\s+/g, " ").trim(), conf };
}

/** Printed labels ("BATTERY:", "DATE：") bleed into region crops; drop up to the last colon
 *  (half- or full-width). Numeric fields extract the number directly, so they're unaffected. */
function stripLabel(text: string): string {
  const i = Math.max(text.lastIndexOf(":"), text.lastIndexOf("："));
  return (i >= 0 ? text.slice(i + 1) : text).trim();
}

export async function recognizeTextRegionsLocally(requests: LocalOcrRequest[]): Promise<LocalOcrResult> {
  const values: Record<string, string> = {};
  const confidence: Record<string, number> = {};
  const flaggedKeys: string[] = [];
  if (requests.length === 0) return { values, confidence, flaggedKeys, unavailable: false };

  let session: ort.InferenceSession;
  let chars: string[];
  try {
    [session, chars] = [await getSession(), loadLabels()];
  } catch (e) {
    console.warn(`[local-ocr] model unavailable: ${(e as Error).message?.slice(0, 200)}`);
    return { values, confidence, flaggedKeys: requests.map((r) => r.key), unavailable: true };
  }
  const inName = session.inputNames[0]!;
  const outName = session.outputNames[0]!;

  for (const req of requests) {
    let text = "";
    let conf = 0;
    try {
      const out = await session.run({ [inName]: await toTensor(req.cropPng) });
      const decoded = ctcDecode(out[outName]!, chars);
      conf = decoded.conf;
      // Strip the printed label prefix; the pipeline applies the same field-kind normalization
      // + numeric extraction to this value as it does to a cloud OCR read (parity).
      text = stripLabel(decoded.text);
    } catch (e) {
      console.warn(`[local-ocr] recognize failed for ${req.key}: ${(e as Error).message?.slice(0, 120)}`);
    }
    if (text) {
      values[req.key] = text;
      confidence[req.key] = conf;
      if (conf < CONFIDENCE_FLAG_THRESHOLD) flaggedKeys.push(req.key);
    } else {
      flaggedKeys.push(req.key); // empty read → always flag, never silently blank
    }
  }
  return { values, confidence, flaggedKeys, unavailable: false };
}
