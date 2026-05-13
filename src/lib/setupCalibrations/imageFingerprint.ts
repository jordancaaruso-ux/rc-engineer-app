import "server-only";

import sharp from "sharp";
import { getOpenAiApiKey } from "@/lib/openaiServerEnv";

/**
 * Lightweight visual signature for an image setup sheet. A small dHash plus a bag of OCR'd header
 * tokens is enough to tell sheet templates apart while ignoring filled-in values.
 */
export type ImageFingerprint = {
  /** 9x8 difference hash, 64 bits hex-encoded (lower-case). */
  pHash64: string;
  /** Lower-cased OCR tokens from the top ~25% of the image (the headers/branding area). */
  headerTokens: string[];
  widthPx: number;
  heightPx: number;
};

/** Compute a 64-bit dHash from raw image bytes. Based on the standard dHash algorithm. */
async function dHashHexFromBytes(bytes: Uint8Array): Promise<string> {
  // Resize to 9x8 grayscale, then for each row compute 8 bits comparing adjacent pixels.
  const { data } = await sharp(Buffer.from(bytes))
    .removeAlpha()
    .grayscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bits: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = data[y * 9 + x] ?? 0;
      const right = data[y * 9 + x + 1] ?? 0;
      bits.push(left < right ? 1 : 0);
    }
  }
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i]! << 3) | (bits[i + 1]! << 2) | (bits[i + 2]! << 1) | bits[i + 3]!;
    hex += nibble.toString(16);
  }
  return hex;
}

/** OCR the top ~25% of the image and return a lower-case token bag. Returns [] when OCR is unavailable. */
async function ocrHeaderTokens(bytes: Uint8Array, widthPx: number, heightPx: number): Promise<string[]> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return [];

  const cropHeight = Math.max(64, Math.round(heightPx * 0.25));
  let cropped: Buffer;
  try {
    cropped = await sharp(Buffer.from(bytes))
      .removeAlpha()
      .extract({ left: 0, top: 0, width: widthPx, height: Math.min(cropHeight, heightPx) })
      .resize({ width: 1024, withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    return [];
  }
  const dataUrl = `data:image/png;base64,${cropped.toString("base64")}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "Extract every readable word from the image header. Return ONLY a single line of words separated by spaces. No punctuation, no commentary.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "List all visible words from the top of this setup sheet header." },
              { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) return [];
    const json = (await res.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    return tokenizeHeaderText(text);
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Split header OCR text into a deduped lower-case alphanumeric token bag (length ≥ 2). */
export function tokenizeHeaderText(text: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of text.split(/[^a-z0-9]+/i)) {
    const t = raw.trim().toLowerCase();
    if (t.length < 2) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    tokens.push(t);
    if (tokens.length >= 64) break;
  }
  return tokens;
}

export async function fingerprintImageBytes(bytes: Uint8Array): Promise<ImageFingerprint> {
  const meta = await sharp(Buffer.from(bytes)).metadata();
  const widthPx = meta.width ?? 0;
  const heightPx = meta.height ?? 0;
  const pHash64 = await dHashHexFromBytes(bytes);
  const headerTokens = widthPx > 0 && heightPx > 0 ? await ocrHeaderTokens(bytes, widthPx, heightPx) : [];
  return { pHash64, headerTokens, widthPx, heightPx };
}

/** Hamming distance between two equal-length hex pHash strings. Returns 64 when lengths differ. */
export function hammingDistanceHex(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const av = parseInt(a[i]!, 16);
    const bv = parseInt(b[i]!, 16);
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return 64;
    let x = av ^ bv;
    while (x) {
      d += x & 1;
      x >>>= 1;
    }
  }
  return d;
}

export function tokenJaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = setA.size + setB.size - inter;
  return union > 0 ? inter / union : 0;
}
