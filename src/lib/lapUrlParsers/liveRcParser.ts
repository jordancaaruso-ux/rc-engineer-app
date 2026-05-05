import type { LapUrlParseContext, LapUrlParseResult, LapUrlParser } from "./types";
import { fetchUrlText } from "./fetchText";
import { parseHtmlDocumentToResult } from "./extractFromHtml";
import { extractRaceSessions, isLiveRcEventHubUrl } from "@/lib/lapWatch/livercSessionIndexParsers";
import { importLiveRcRaceResult, isLiveRcRaceResultUrl } from "./livercRaceResult";
import { importLiveRcPracticeSession, isLiveRcPracticeSessionUrl } from "./livercPracticeSession";

function getFetchErrorMessage(result: { ok?: boolean; error?: string }): string {
  if (result && result.ok === false && typeof result.error === "string") return result.error;
  return "Fetch failed";
}

export const liveRcParser: LapUrlParser = {
  id: "liverc_deterministic_v1",

  canHandle(url: string): boolean {
    return isLiveRcPracticeSessionUrl(url) || isLiveRcRaceResultUrl(url) || isLiveRcEventHubUrl(url);
  },

  async parse(url: string, context?: LapUrlParseContext): Promise<LapUrlParseResult> {
    const trimmed = url.trim();

    try {
      if (isLiveRcPracticeSessionUrl(trimmed)) {
        console.info("[liveRc-import] practice", { url: trimmed });
        const result = await importLiveRcPracticeSession(trimmed);
        if (result.laps.length === 0) {
          return {
            ...result,
            message: result.message ?? "Could not parse practice laps from this LiveRC page.",
          };
        }
        return result;
      }

      if (isLiveRcRaceResultUrl(trimmed)) {
        return importLiveRcRaceResult(trimmed, context?.driverName);
      }

      if (isLiveRcEventHubUrl(trimmed)) {
        const hubFetch = await fetchUrlText(trimmed);
        if (!hubFetch.ok) {
          return {
            parserId: this.id,
            laps: [],
            candidates: [],
            message: hubFetch.error,
            errorCode: "fetch_failed",
          };
        }
        const rows = extractRaceSessions(hubFetch.text, trimmed);
        const discoveredRaceUrls = [...new Set(rows.map((r) => r.sessionUrl.trim()).filter(Boolean))];
        if (discoveredRaceUrls.length === 0) {
          return {
            parserId: this.id,
            laps: [],
            candidates: [],
            discoveredRaceUrls: [],
            message: "No race result links found on this LiveRC event page.",
            errorCode: "live_rc_event_hub_empty",
          };
        }
        return {
          parserId: this.id,
          laps: [],
          candidates: [],
          discoveredRaceUrls,
          message: `This event page lists ${discoveredRaceUrls.length} race result session(s). Import again from the lap library (or Log your run) — the server expands the hub and imports each session. Set your LiveRC driver name in Settings for the correct row.`,
          errorCode: "live_rc_event_hub",
        };
      }

      return {
        parserId: this.id,
        laps: [],
        candidates: [],
        message: "Unsupported LiveRC URL pattern",
        errorCode: "unsupported_url",
      };
    } catch (e) {
      console.info("[liveRc-import] error fallback", { err: e instanceof Error ? e.message : String(e) });
      const fetched = await fetchUrlText(trimmed);
      if (!fetched.ok) {
        return {
          parserId: this.id,
          laps: [],
          candidates: [],
          message: getFetchErrorMessage(fetched),
          errorCode: "fetch_failed",
        };
      }
      const generic = parseHtmlDocumentToResult(fetched.text, "http_html_fallback", trimmed);
      return {
        ...generic,
        parserId: this.id,
      };
    }
  },
};
