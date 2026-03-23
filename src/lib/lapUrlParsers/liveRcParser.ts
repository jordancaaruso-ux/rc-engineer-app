import { load, type CheerioAPI } from "cheerio";
import type { LapUrlParseContext, LapUrlParseResult, LapUrlParser } from "./types";
import { fetchUrlText } from "./fetchText";
import { parseHtmlDocumentToResult } from "./extractFromHtml";
import { importLiveRcRaceResult, isLiveRcRaceResultUrl } from "./livercRaceResult";

function getFetchErrorMessage(result: any): string {
  if (result && result.ok === false && typeof result.error === "string") return result.error;
  return "Fetch failed";
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function decimalNumberRegex() {
  // Lap times are usually printed as 1–3 digits, dot, then 2–4 decimals.
  // Examples: 12.345, 9.832, 1.2345
  return /\b(\d{1,3}[.,]\d{2,4})\b/g;
}

function parseLapTimeToken(token: string): number | null {
  const v = Number.parseFloat(token.replace(",", "."));
  if (!Number.isFinite(v)) return null;
  // Strict-ish sanity range for RC lap times.
  if (v < 3 || v > 240) return null;
  return v;
}

function extractLapTimesFromText(text: string): { laps: number[]; discarded: number } {
  const out: number[] = [];
  let discarded = 0;
  const re = decimalNumberRegex();
  const matches = text.match(re) ?? [];
  for (const m of matches) {
    const parsed = parseLapTimeToken(m);
    if (parsed == null) {
      discarded += 1;
      continue;
    }
    out.push(parsed);
  }
  return { laps: out, discarded };
}

function findClosestSectionContainingLapTimes($: CheerioAPI, startNode: any): any | null {
  if (!startNode) return null;
  const start = $(startNode);
  // Walk up a few levels and pick the one with the most lap-shaped numbers.
  const candidates: any[] = [];
  let cur: any | null = startNode;
  for (let i = 0; i < 6 && cur; i++) {
    candidates.push(cur);
    cur = $(cur).parent().get(0) ?? null;
  }

  let best: any | null = null;
  let bestCount = -1;
  for (const c of candidates) {
    const txt = normalizeWhitespace($(c).text() ?? "");
    const { laps } = extractLapTimesFromText(txt);
    if (laps.length > bestCount) {
      bestCount = laps.length;
      best = c;
    }
  }
  return best;
}

function findLaptimesSection($: CheerioAPI): any | null {
  // Find a node whose text looks like the label “Laptimes”.
  const laptimesNodes = $("*")
    .filter((_, el) => {
      const t = normalizeWhitespace($(el).text() ?? "").toLowerCase();
      return t === "laptimes" || t.includes("laptimes");
    })
    .toArray()
    .slice(0, 80);

  for (const node of laptimesNodes) {
    const section = findClosestSectionContainingLapTimes($, node);
    if (section) {
      const txt = normalizeWhitespace($(section).text() ?? "");
      const { laps } = extractLapTimesFromText(txt);
      if (laps.length > 0) return section;
    }
  }
  return null;
}

function extractLapsFromLaptimesGraph($: CheerioAPI, sectionNode: any): {
  laps: number[];
  discarded: number;
  lapSourceSummary: string;
} {
  const section = $(sectionNode);
  const graph = section.find("svg, canvas, [class*='graph' i], [class*='bar' i], [id*='graph' i], [data-testid*='graph' i]").first();
  if (!graph || graph.length === 0) {
    return { laps: [], discarded: 0, lapSourceSummary: "no graph container found" };
  }

  // Prefer extracting from graph container text/attributes only.
  const graphText = normalizeWhitespace(graph.text() ?? "");
  const graphAttrTokens: string[] = [];
  graph.find("*").each((_, el) => {
    const e = $(el);
    for (const attr of ["data-value", "aria-label", "title", "aria-valuetext"]) {
      const v = e.attr(attr);
      if (v) graphAttrTokens.push(String(v));
    }
  });

  const combined = [graphText, ...graphAttrTokens].filter(Boolean).join(" ");
  const { laps, discarded } = extractLapTimesFromText(combined);

  return {
    laps,
    discarded,
    lapSourceSummary: graphText ? "graph container text" : "graph container attributes",
  };
}

function isLiveRcPracticeSession(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    const p = (u.searchParams.get("p") ?? "").toLowerCase();
    const path = u.pathname.toLowerCase().replace(/\/+$/, "");
    // /practice/?p=view_session
    return path.endsWith("/practice") && p === "view_session";
  } catch {
    return false;
  }
}

async function extractLapsFromUrlPracticeLike(url: string): Promise<{
  laps: number[];
  discarded: number;
  debug: { laptimesSectionFound: boolean; graphFound: boolean };
}> {
  const fetched = await fetchUrlText(url);
  if (!fetched.ok) {
    return {
      laps: [],
      discarded: 0,
      debug: { laptimesSectionFound: false, graphFound: false },
    };
  }

  const $ = load(fetched.text);
  const laptimesSection = findLaptimesSection($);
  if (!laptimesSection) {
    return {
      laps: [],
      discarded: 0,
      debug: { laptimesSectionFound: false, graphFound: false },
    };
  }

  const graphCandidates = $(laptimesSection).find(
    'svg, canvas, [class*="graph" i], [class*="bar" i], [id*="graph" i], [data-testid*="graph" i]'
  );
  const graphFound = graphCandidates.length > 0;

  const { laps, discarded } = extractLapsFromLaptimesGraph($, laptimesSection);
  return {
    laps,
    discarded,
    debug: { laptimesSectionFound: true, graphFound },
  };
}

export const liveRcParser: LapUrlParser = {
  id: "liverc_deterministic_v1",

  canHandle(url: string): boolean {
    return isLiveRcPracticeSession(url) || isLiveRcRaceResultUrl(url);
  },

  async parse(url: string, context?: LapUrlParseContext): Promise<LapUrlParseResult> {
    const trimmed = url.trim();

    try {
      if (isLiveRcPracticeSession(trimmed)) {
        const debugLogPrefix = "[liveRc-import] practice";
        console.info(debugLogPrefix, { url: trimmed });

        const practice = await extractLapsFromUrlPracticeLike(trimmed);
        console.info(`${debugLogPrefix} debug`, practice.debug);

        const laps = practice.laps;
        console.info(`${debugLogPrefix} laps`, { extracted: laps.length, discarded: practice.discarded });

        if (laps.length === 0) {
          // Fallback to generic HTML lap parsing so this doesn't block the import flow.
          const fetched = await fetchUrlText(trimmed);
          if (!fetched.ok) {
            return {
              parserId: this.id,
              laps: [],
              candidates: [],
              message: getFetchErrorMessage(fetched),
            };
          }
          const generic = parseHtmlDocumentToResult(fetched.text, this.id, trimmed);
          return {
            ...generic,
            parserId: this.id,
            message:
              generic.laps.length > 0
                ? generic.message
                : "Could not find valid lap times on this LiveRC page",
          };
        }

        return {
          parserId: this.id,
          laps,
          candidates: [
            {
              id: "liverc_laptimes_graph",
              label: "LiveRC Laptimes graph (deterministic)",
              laps,
              roleHint: "primary",
            },
          ],
          message: `Imported ${laps.length} laps from LiveRC Laptimes graph.`,
        };
      }

      if (isLiveRcRaceResultUrl(trimmed)) {
        return importLiveRcRaceResult(trimmed, context?.driverName ?? "");
      }

      // Shouldn't happen because canHandle checked; keep generic fallback.
      return {
        parserId: this.id,
        laps: [],
        candidates: [],
        message: "Unsupported LiveRC URL pattern",
      };
    } catch (e) {
      // Final fallback: generic HTML parsing so we don't block manual entry.
      console.info("[liveRc-import] error fallback", { err: e instanceof Error ? e.message : String(e) });
      const fetched = await fetchUrlText(trimmed);
      if (!fetched.ok) {
        return { parserId: this.id, laps: [], candidates: [], message: getFetchErrorMessage(fetched) };
      }
      const generic = parseHtmlDocumentToResult(fetched.text, "http_html_fallback", trimmed);
      return {
        ...generic,
        parserId: this.id,
      };
    }
  },
};

