import { load } from "cheerio";
import type { LapUrlParseResult } from "./types";

/**
 * Heuristic: collect decimal numbers that look like RC lap times (e.g. 12.345)
 * from visible page text. May include false positives — user confirms in UI.
 */
export function parseHtmlDocumentToResult(html: string, parserId: string, url: string): LapUrlParseResult {
  let text: string;
  try {
    const $ = load(html);
    text = $("body").text().replace(/\s+/g, " ");
  } catch {
    text = html.replace(/\s+/g, " ");
  }

  const re = /\b(\d{1,2}\.\d{2,4})\b/g;
  const laps: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = parseFloat(m[1]!);
    if (v >= 3 && v <= 240) laps.push(v);
    if (laps.length >= 250) break;
  }

  if (laps.length === 0) {
    return {
      parserId,
      laps: [],
      candidates: [],
      message:
        "No lap-shaped numbers (e.g. 12.345) found in page text. This site may load results in JavaScript only — try exporting JSON or a screenshot instead.",
    };
  }

  const candidate = {
    id: "html_text",
    label: "Detected from page text (verify order)",
    laps,
    roleHint: "unknown" as const,
  };

  return {
    parserId,
    laps,
    candidates: [candidate],
    sessionHint: { name: null, className: null },
    message: `Found ${laps.length} values matching lap-time pattern. Some may be noise — trim or edit in the box below before saving.`,
  };
}
