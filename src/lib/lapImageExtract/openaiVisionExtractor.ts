import type { LapImageExtractionResult, LapImageExtractor } from "./types";
import { normalizeAndValidatePhotoExtraction } from "./photoExtractionSchema";
import { getOpenAiApiKey } from "@/lib/openaiServerEnv";

const MODEL = "gpt-4o-mini";

/**
 * Uses OpenAI Chat Completions (vision) with JSON object mode.
 * Requires OPENAI_API_KEY on the server.
 */
export const openaiVisionLapExtractor: LapImageExtractor = {
  id: "openai_gpt4o_mini_vision_v1",

  async extract(file: File): Promise<LapImageExtractionResult> {
    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      return {
        laps: [],
        note: "Photo lap read is not configured. Add OPENAI_API_KEY to your .env file and restart the dev server.",
        meta: { configured: false },
      };
    }

    const mime = file.type || "image/jpeg";
    const buf = Buffer.from(await file.arrayBuffer());
    const base64 = buf.toString("base64");
    const dataUrl = `data:${mime};base64,${base64}`;

    const system = `You read RC (radio control) car lap timing screenshots and timing app exports.
Return ONLY valid JSON (no markdown) matching this shape:
{"laps": number[], "notes": string | null, "confidence": "high" | "medium" | "low"}

Rules:
- laps: each lap time in SECONDS as a decimal number (e.g. 12.341). Order must match the screenshot top-to-bottom or left-to-right as shown.
- Omit invalid rows (pit, OUT, —). Do not invent laps.
- If unsure or image has no readable laps, return laps: [] and confidence "low" and explain in notes.
- confidence: high = clear timing table; medium = some ambiguity; low = poor image or no laps.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Extract all lap times from this image as JSON.",
                },
                {
                  type: "image_url",
                  image_url: { url: dataUrl, detail: "high" },
                },
              ],
            },
          ],
        }),
      });

      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const err =
          (data.error as { message?: string } | undefined)?.message ||
          `OpenAI error (${res.status})`;
        return {
          laps: [],
          note: err,
          meta: { openaiStatus: res.status },
        };
      }

      const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
      const text = choices?.[0]?.message?.content?.trim() ?? "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return {
          laps: [],
          note: "Model returned non-JSON. Try a clearer screenshot or use manual entry.",
          meta: { raw: text.slice(0, 200) },
        };
      }

      const validated = normalizeAndValidatePhotoExtraction(parsed);
      const noteParts: string[] = [];
      if (validated.notes) noteParts.push(validated.notes);
      noteParts.push(`Confidence: ${validated.confidence}.`);
      return {
        laps: validated.laps,
        note: noteParts.join(" "),
        meta: {
          model: MODEL,
          confidence: validated.confidence,
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Vision request failed";
      return {
        laps: [],
        note: msg.includes("abort") ? "Photo analysis timed out. Try a smaller image." : msg,
        meta: {},
      };
    } finally {
      clearTimeout(timeout);
    }
  },
};
