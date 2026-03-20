import type { LapUrlParser, LapUrlParseResult } from "./types";
import { fetchUrlText } from "./fetchText";
import { parseJsonDocumentToResult } from "./extractFromJson";
import { parseHtmlDocumentToResult } from "./extractFromHtml";

/**
 * First real URL MVP: fetch any http(s) document, then:
 * - If body parses as JSON → structured lap candidates
 * - Else → HTML text heuristic for lap-like decimals
 */
export const httpTimingParser: LapUrlParser = {
  id: "http_timing_v1",

  canHandle(url: string): boolean {
    try {
      const u = new URL(url.trim());
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  },

  async parse(url: string): Promise<LapUrlParseResult> {
    const trimmed = url.trim();
    const fetched = await fetchUrlText(trimmed);
    if (!fetched.ok) {
      return {
        parserId: this.id,
        laps: [],
        candidates: [],
        message: fetched.error,
      };
    }

    const { text, contentType } = fetched;
    const trimmedText = text.trim();
    const looksJson =
      contentType.includes("application/json") ||
      contentType.includes("+json") ||
      trimmedText.startsWith("{") ||
      trimmedText.startsWith("[");

    if (looksJson) {
      try {
        JSON.parse(trimmedText);
        const jsonResult = parseJsonDocumentToResult(trimmedText, this.id, trimmed);
        if (jsonResult.laps.length > 0 || (jsonResult.candidates?.length ?? 0) > 0) {
          return jsonResult;
        }
      } catch {
        /* not valid JSON — try HTML heuristics on raw text */
      }
    }

    return parseHtmlDocumentToResult(text, this.id, trimmed);
  },
};
