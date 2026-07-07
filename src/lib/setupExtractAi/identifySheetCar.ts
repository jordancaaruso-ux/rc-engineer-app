import sharp from "sharp";

/**
 * Identify which car a setup sheet is for by reading its printed branding/header
 * (SETUP_UPLOAD_NORTH_STAR.md front door). Brand/model text is printed black — an easy,
 * high-confidence read — so a cheap model on a cropped header strip is enough; no need for
 * the full dual-model extractor here.
 *
 * No "server-only" import (API key is a parameter) so the eval/scripts can exercise it.
 */

export type IdentifiedSheetCar = {
  brand: string | null;
  /** Model / platform as printed on the sheet, e.g. "X4'22". */
  model: string | null;
  /** Discipline if the sheet states it (e.g. "1/10 touring"); usually null. */
  discipline: string | null;
  /** Verbatim branding text the model read, for debugging/audit. */
  rawHeaderText: string;
  confidence: number;
};

export const DEFAULT_SHEET_ID_MODEL = "gpt-4o";

const SYSTEM_PROMPT = `You are identifying which RC car a setup sheet is for, from its printed branding/header (logos, title, footer). Return ONLY the manufacturer and model/platform exactly as printed.

Rules:
- brand: the manufacturer (e.g. "Xray", "Mugen", "Yokomo", "Awesomatix", "Tamiya"). null if not visible.
- model: the chassis/platform designation as printed (e.g. "X4'22", "MTC3", "A800"). Keep year/version marks. null if not visible.
- discipline: only if explicitly printed (e.g. "1/10 touring"); otherwise null.
- Read only the printed template branding — never infer from handwritten setup values.
- confidence: 0..1 that brand+model are exactly right.

Return JSON: {"brand": string|null, "model": string|null, "discipline": string|null, "rawHeaderText": string, "confidence": number}`;

export async function identifySheetCar(input: {
  apiKey: string;
  imageBytes: Buffer;
  imageMime: "image/png" | "image/jpeg";
  model?: string;
}): Promise<IdentifiedSheetCar> {
  const model = input.model?.trim() || DEFAULT_SHEET_ID_MODEL;

  // Branding sits in the top strip; cropping keeps the call cheap and focused. Fall back to
  // the full image if the crop fails for any reason.
  let headerBytes = input.imageBytes;
  let mime: "image/png" | "image/jpeg" = input.imageMime;
  try {
    const meta = await sharp(input.imageBytes).metadata();
    const h = meta.height ?? 0;
    if (h > 0) {
      headerBytes = await sharp(input.imageBytes)
        .extract({ left: 0, top: 0, width: meta.width ?? 0, height: Math.max(1, Math.round(h * 0.16)) })
        .png()
        .toBuffer();
      mime = "image/png";
    }
  } catch {
    /* use full image */
  }

  const dataUrl = `data:${mime};base64,${headerBytes.toString("base64")}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 300,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Identify the car from this setup sheet header." },
              { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Car identification failed: ${res.status} ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(json.choices?.[0]?.message?.content?.trim() ?? "{}") as Record<string, unknown>;
    const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
    const confRaw = typeof parsed.confidence === "number" ? parsed.confidence : 0;
    return {
      brand: str(parsed.brand),
      model: str(parsed.model),
      discipline: str(parsed.discipline),
      rawHeaderText: str(parsed.rawHeaderText) ?? "",
      confidence: Math.max(0, Math.min(1, confRaw)),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
