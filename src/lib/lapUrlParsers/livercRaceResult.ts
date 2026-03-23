/**
 * LiveRC race result page: /results/?p=view_race_result&id=...
 * Primary: embedded repeated `racerLaps[driverId] = { ... }` assignments in page scripts.
 * No modal URL guessing — embed is the source of truth.
 */

import { load, type CheerioAPI, type Element } from "cheerio";
import type { LapImportLapRow, LapUrlParseResult } from "./types";
import { fetchUrlText } from "./fetchText";

const PARSER_ID = "liverc_race_result_v1";
const LOG_PREFIX = "[liveRc-race-result]";

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function normalizeNameKey(s: string): string {
  return normalizeWhitespace(s).toLowerCase();
}

/** Public: strict LiveRC race-result URL (single session). */
export function isLiveRcRaceResultUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr.trim());
    if (!/\.liverc\.com$/i.test(u.hostname)) return false;
    const path = u.pathname.toLowerCase().replace(/\/+$/, "");
    if (!path.endsWith("/results")) return false;
    const p = (u.searchParams.get("p") ?? "").toLowerCase();
    const id = u.searchParams.get("id");
    return p === "view_race_result" && Boolean(id?.trim());
  } catch {
    return false;
  }
}

/** One row from the main results table (`.driver_name` + `a.driver_laps[data-driver-id]`). */
export type ParsedLiveRcResultRow = {
  driverName: string;
  normalizedDriverName: string;
  surname: string;
  driverId: string;
};

/**
 * Parse LiveRC DataTables-style result rows. Only rows with both `.driver_name` and
 * `a.driver_laps[data-driver-id]` are included — no loose page-wide matching.
 */
export function parseLiveRcRaceResultTableRows(html: string): ParsedLiveRcResultRow[] {
  const $ = load(html);
  const out: ParsedLiveRcResultRow[] = [];

  $("tr").each((_, tr) => {
    const row = $(tr);
    const nameEl = row.find(".driver_name").first();
    const lapsLink = row.find("a.driver_laps").first();
    if (!nameEl.length || !lapsLink.length) return;

    const driverId = lapsLink.attr("data-driver-id")?.trim();
    if (!driverId) return;

    const driverName = normalizeWhitespace(nameEl.text());
    if (!driverName) return;

    const normalizedDriverName = normalizeNameKey(driverName);
    const parts = normalizedDriverName.split(/\s+/).filter(Boolean);
    const surname = parts.length ? parts[parts.length - 1]! : "";

    out.push({
      driverName,
      normalizedDriverName,
      surname,
      driverId,
    });
  });

  const seen = new Set<string>();
  const deduped: ParsedLiveRcResultRow[] = [];
  for (const r of out) {
    const k = `${r.driverId}|${r.normalizedDriverName}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(r);
  }
  return deduped;
}

/**
 * Match: case-insensitive full name first; surname-only only when exactly one row has that surname.
 */
export function matchDriverRow(rows: ParsedLiveRcResultRow[], driverName: string): ParsedLiveRcResultRow | null {
  const want = normalizeNameKey(driverName);
  if (!want) return null;

  const fullMatches = rows.filter((r) => r.normalizedDriverName === want);
  if (fullMatches.length === 1) return fullMatches[0]!;
  if (fullMatches.length > 1) return null;

  const wantParts = want.split(/\s+/).filter(Boolean);
  const surnameQuery = wantParts.length ? wantParts[wantParts.length - 1]! : "";
  if (surnameQuery.length < 2) return null;

  const bySurname = rows.filter((r) => r.surname === surnameQuery);
  if (bySurname.length === 1) return bySurname[0]!;
  return null;
}

/** Concatenate inline script sources for embedded data extraction (no execution). */
export function concatenatePageScriptSources(html: string): string {
  const $ = load(html);
  const parts: string[] = [];
  $("script").each((_, el) => {
    const t = $(el).html();
    if (t) parts.push(t);
  });
  return parts.join("\n");
}

/** Regex discover `racerLaps[123] =` keys for logging / diagnostics. */
export function findRacerLapsKeysInScript(script: string): string[] {
  const keys = new Set<string>();
  const re = /racerLaps\[(\d+)\]\s*=/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(script)) !== null) {
    keys.add(m[1]!);
  }
  return [...keys];
}

function skipQuotedString(s: string, i: number): number {
  const q = s[i];
  if (q !== "'" && q !== '"') return i;
  i++;
  while (i < s.length) {
    if (s[i] === "\\") {
      i += 2;
      continue;
    }
    if (s[i] === q) return i + 1;
    i++;
  }
  return s.length;
}

/**
 * Skip JS template literal starting at backtick; handles `${ ... }` so inner `}`
 * does not corrupt outer brace matching.
 */
function skipTemplateLiteral(s: string, i: number): number {
  if (s[i] !== "`") return i;
  i++;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "`") return i + 1;
    if (c === "$" && s[i + 1] === "{") {
      i += 2;
      let depth = 1;
      while (i < s.length && depth > 0) {
        const ch = s[i];
        if (ch === "'" || ch === '"') {
          i = skipQuotedString(s, i);
          continue;
        }
        if (ch === "`") {
          i = skipTemplateLiteral(s, i);
          continue;
        }
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        i++;
      }
      continue;
    }
    i++;
  }
  return s.length;
}

/**
 * Find index of matching closing bracket, respecting strings, // and /* comments.
 */
function findClosingDelimiter(s: string, start: number, open: string, close: string): number | null {
  if (s[start] !== open) return null;
  let depth = 1;
  let i = start + 1;
  while (i < s.length && depth > 0) {
    const c = s[i];
    if (c === "'" || c === '"') {
      i = skipQuotedString(s, i);
      continue;
    }
    if (c === "`") {
      i = skipTemplateLiteral(s, i);
      continue;
    }
    if (c === "/" && s[i + 1] === "/") {
      i += 2;
      while (i < s.length && s[i] !== "\n" && s[i] !== "\r") i++;
      continue;
    }
    if (c === "/" && s[i + 1] === "*") {
      i += 2;
      while (i < s.length - 1 && !(s[i] === "*" && s[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) depth--;
    i++;
  }
  if (depth !== 0) return null;
  return i - 1;
}

function findRacerLapsObjectStartIndex(script: string, driverId: string): number | null {
  const esc = driverId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`racerLaps\\[${esc}\\]\\s*=\\s*\\{`),
    new RegExp(`racerLaps\\['${esc}'\\]\\s*=\\s*\\{`),
    new RegExp(`racerLaps\\["${esc}"\\]\\s*=\\s*\\{`),
  ];
  for (const re of patterns) {
    const m = re.exec(script);
    if (m) return m.index + m[0].length - 1;
  }
  return null;
}

function pushLapFromParts(laps: number[], lapNum: number, rawTime: string): void {
  if (lapNum === 0) return;
  const raw = rawTime.replace(",", ".");
  const t = Number.parseFloat(raw);
  if (!Number.isFinite(t)) return;
  laps.push(t);
}

/**
 * Parse `laps: [...]` from one `racerLaps[id] = { ... }` object slice (no eval).
 * Handles repeated-assignment style objects; falls back to ordered regex on the array body.
 */
export function extractLapTimesFromRacerLapsObjectText(objText: string): number[] {
  const lapsKey = /laps\s*:\s*\[/.exec(objText);
  if (!lapsKey) return [];

  const bracketOpen = lapsKey.index + lapsKey[0].length - 1;
  const bracketClose = findClosingDelimiter(objText, bracketOpen, "[", "]");
  if (bracketClose == null) return [];

  const inner = objText.slice(bracketOpen + 1, bracketClose);
  const laps: number[] = [];

  const objectChunks = inner.match(/\{[^{}]*\}/g) ?? [];
  for (const chunk of objectChunks) {
    const lapNumM = chunk.match(/lapNum\s*:\s*['"]?(\d+)['"]?/);
    const timeM = chunk.match(/time\s*:\s*['"]?([\d.,]+)['"]?/);
    if (!lapNumM || !timeM) continue;
    pushLapFromParts(laps, Number.parseInt(lapNumM[1]!, 10), timeM[1]!);
  }

  if (laps.length > 0) return laps;

  // Fallback: property order / minified objects where brace-chunk split failed
  const forward = /lapNum\s*:\s*['"]?(\d+)['"]?\s*,\s*time\s*:\s*['"]?([\d.,]+)['"]?/g;
  let m: RegExpExecArray | null;
  while ((m = forward.exec(inner)) !== null) {
    pushLapFromParts(laps, Number.parseInt(m[1]!, 10), m[2]!);
  }
  if (laps.length > 0) return laps;

  const reversed = /time\s*:\s*['"]?([\d.,]+)['"]?\s*,\s*lapNum\s*:\s*['"]?(\d+)['"]?/g;
  while ((m = reversed.exec(inner)) !== null) {
    pushLapFromParts(laps, Number.parseInt(m[2]!, 10), m[1]!);
  }

  return laps;
}

/**
 * True if any script block contains `racerLaps` (assignment pattern).
 */
export function pageHtmlContainsRacerLaps(html: string): boolean {
  const script = concatenatePageScriptSources(html);
  return /\bracerLaps\s*\[\s*\d+\s*\]\s*=/.test(script);
}

/**
 * Extract lap times from embedded `racerLaps[driverId] = { ... }` in full page HTML
 * (repeated assignment form). Returns null when parsing yields no laps.
 */
export function tryExtractLapsFromRacerLapsEmbed(html: string, driverId: string): {
  laps: number[];
  keys: string[];
} | null {
  const script = concatenatePageScriptSources(html);
  if (!/\bracerLaps\b/.test(script)) {
    console.info(LOG_PREFIX, "embed_fail", { reason: "no_racerLaps_token", driverId });
    return null;
  }

  const keys = findRacerLapsKeysInScript(script);
  const objStart = findRacerLapsObjectStartIndex(script, driverId);
  if (objStart == null) {
    const preview = pickRacerLapsSnippet(script, driverId);
    console.info(LOG_PREFIX, "embed_fail", {
      reason: "assignment_not_found",
      driverId,
      keys,
      keysIncludeDriverId: keys.includes(driverId),
      snippetAroundDriver: preview,
    });
    return null;
  }

  const objEnd = findClosingDelimiter(script, objStart, "{", "}");
  if (objEnd == null) {
    const preview = pickRacerLapsSnippet(script, driverId);
    console.info(LOG_PREFIX, "embed_fail", {
      reason: "unbalanced_braces_outer_object",
      driverId,
      keys,
      objStart,
      snippetAroundDriver: preview,
    });
    return null;
  }

  const objText = script.slice(objStart, objEnd + 1);
  const laps = extractLapTimesFromRacerLapsObjectText(objText);
  if (laps.length === 0) {
    const lapsIdx = objText.search(/laps\s*:\s*\[/);
    console.info(LOG_PREFIX, "embed_fail", {
      reason: "no_laps_extracted",
      driverId,
      keys,
      objTextLength: objText.length,
      hasLapsKey: lapsIdx >= 0,
      objTextHead: objText.slice(0, 400),
    });
    return null;
  }

  return { laps, keys };
}

/** ~500 chars around `racerLaps[driverId]` for logs (no eval). */
function pickRacerLapsSnippet(script: string, driverId: string): string {
  const esc = driverId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`racerLaps\\[(?:'|")?${esc}(?:'|")?\\]\\s*=`);
  const m = re.exec(script);
  const pos = m?.index ?? script.search(/racerLaps\s*\[/);
  if (pos < 0) return script.slice(0, 500);
  const start = Math.max(0, pos - 60);
  return script.slice(start, start + 520);
}

/**
 * Build candidate URLs to fetch the driver lap modal HTML. LiveRC uses `href="#"` + JS;
 * server-side we request likely PHP endpoints with race `id` + `driver_id`.
 */
export function buildDriverLapsFetchCandidates(pageUrl: string, driverId: string): string[] {
  let u: URL;
  try {
    u = new URL(pageUrl.trim());
  } catch {
    return [];
  }
  const raceId = u.searchParams.get("id");
  if (!raceId?.trim()) return [];

  const origin = u.origin;
  const path = (u.pathname.replace(/\/+$/, "") || "/results") + "/";
  const base = `${origin}${path}`.replace(/\/+$/, "/");
  const r = encodeURIComponent(raceId.trim());
  const d = encodeURIComponent(driverId.trim());

  return [
    `${base}?p=view_driver_laps&id=${r}&driver_id=${d}`,
    `${base}?p=view_driver_laps&driver_id=${d}&id=${r}`,
    `${base}?p=view_laps&id=${r}&driver_id=${d}`,
    `${base}?p=driver_laps&id=${r}&driver_id=${d}`,
    `${base}?p=view_race_laps&id=${r}&driver_id=${d}`,
    `${base}?p=ajax_driver_laps&id=${r}&driver_id=${d}`,
  ];
}

function parseLapTimeToken(raw: string): number | null {
  const t = normalizeWhitespace(raw).replace(",", ".");
  if (/^\d+\/\d+:/.test(t)) return null;
  const m = t.match(/(\d{1,3}\.\d{2,4})/);
  const v = Number.parseFloat(m?.[1] ?? t);
  if (!Number.isFinite(v)) return null;
  if (v < 3 || v > 240) return null;
  return v;
}

/** Visible text in a cell, excluding `.hidden` summaries LiveRC embeds beside the real Time. */
function timeCellVisibleText($: CheerioAPI, el: Element | undefined): string {
  if (el == null) return "";
  const c = $(el).clone();
  c.find(".hidden, [hidden]").remove();
  return normalizeWhitespace(c.text());
}

/** Fastest lap shown in the results grid (min of X.XXX-shaped times in row cells). */
export function extractDisplayedFastestLapFromResultRow($: CheerioAPI, row: Element): number | null {
  let best: number | null = null;
  $(row)
    .find("td")
    .each((_, td) => {
      const raw = timeCellVisibleText($, td);
      const re = /(\d{1,3}\.\d{2,4})/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(raw)) !== null) {
        const v = Number.parseFloat(m[1]!);
        if (Number.isFinite(v) && v >= 3 && v <= 240) {
          if (best === null || v < best) best = v;
        }
      }
    });
  return best;
}

/**
 * Lap times from driver-lap modal HTML only: table column headed "Time", in row order.
 * Skips aggregate / total-time shaped values (e.g. 21/5:13.016).
 */
export function extractLapTimesFromLiveRcModal($: CheerioAPI): { laps: number[]; strategy: string } {
  const modalRoots = $(
    "[class*='modal' i], [id*='modal' i], [id*='driver' i][id*='lap' i], .driver_laps_content, #driver_laps"
  )
    .toArray()
    .slice(0, 50);

  const tryTable = (root: unknown): { laps: number[]; strategy: string } | null => {
    const scope = $(root as never);
    const tables = scope.find("table").toArray();
    const tableEls = tables.length ? tables : (root as { name?: string })?.name === "table" ? [root] : [];

    for (const table of tableEls) {
      const $t = $(table);
      let timeIdx = -1;
      let headerRowIndex = -1;

      const trs = $t.find("tr");
      outer: for (let ri = 0; ri < trs.length; ri++) {
        const row = trs.eq(ri);
        const hdrCells = row.find("th, td");
        for (let i = 0; i < hdrCells.length; i++) {
          const txt = normalizeWhitespace(hdrCells.eq(i).text()).toLowerCase();
          if (txt === "time" || /^time\b/.test(txt)) {
            timeIdx = i;
            headerRowIndex = ri;
            break outer;
          }
        }
      }

      if (timeIdx < 0) continue;

      const laps: number[] = [];
      $t.find("tr").each((ri, tr) => {
        if (ri <= headerRowIndex) return;
        const cells = $(tr).find("td");
        if (cells.length <= timeIdx) return;
        const td = cells.get(timeIdx);
        const timeCell = $(td);
        const bold = timeCell.find("b, strong").first();
        const raw = bold.length ? bold.text() : timeCellVisibleText($, td);
        const n = parseLapTimeToken(raw);
        if (n != null) laps.push(n);
      });

      if (laps.length > 0) return { laps, strategy: "modal_table_time_column" };
    }
    return null;
  };

  for (const root of modalRoots) {
    const got = tryTable(root);
    if (got) return got;
  }

  const body = $("body");
  const gotBody = tryTable(body.get(0) ?? body);
  if (gotBody) return gotBody;

  return { laps: [], strategy: "none" };
}

export function computeMedianLap(laps: number[]): number | null {
  if (laps.length === 0) return null;
  const sorted = [...laps].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const a = sorted[mid - 1]!;
  const b = sorted[mid]!;
  return (a + b) / 2;
}

export function markMedianOutlierWarnings(laps: number[], threshold = 0.3): LapImportLapRow[] {
  const median = computeMedianLap(laps);
  if (median == null || median <= 0) {
    return laps.map((time) => ({
      time,
      isOutlierWarning: false,
      warningReason: null,
      isFlagged: false,
      flagReason: null,
    }));
  }
  return laps.map((time) => {
    const dev = Math.abs(time - median) / median;
    const isOutlier = dev > threshold;
    return {
      time,
      isOutlierWarning: isOutlier,
      warningReason: isOutlier ? "More than 30% away from median" : null,
      isFlagged: false,
      flagReason: null,
    };
  });
}

export async function loadLiveRcLapModalHtml(url: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const fetched = await fetchUrlText(url);
  if (!fetched.ok) {
    return { ok: false, error: fetched.error };
  }
  return { ok: true, text: fetched.text };
}

export async function importLiveRcRaceResult(pageUrl: string, driverName: string): Promise<LapUrlParseResult> {
  const trimmedUrl = pageUrl.trim();
  const name = driverName.trim();

  if (!isLiveRcRaceResultUrl(trimmedUrl)) {
    return {
      parserId: PARSER_ID,
      laps: [],
      candidates: [],
      message: "Unsupported LiveRC URL format",
      errorCode: "unsupported_url",
    };
  }

  if (!name) {
    return {
      parserId: PARSER_ID,
      laps: [],
      candidates: [],
      message: "Enter the driver name as shown on the results.",
      errorCode: "driver_name_required",
    };
  }

  const mainFetch = await fetchUrlText(trimmedUrl);
  if (!mainFetch.ok) {
    return {
      parserId: PARSER_ID,
      laps: [],
      candidates: [],
      message: mainFetch.error,
    };
  }

  const rows = parseLiveRcRaceResultTableRows(mainFetch.text);
  console.info(LOG_PREFIX, "rows_parsed", { count: rows.length, names: rows.map((r) => r.driverName) });

  const matched = matchDriverRow(rows, name);
  if (!matched) {
    console.info(LOG_PREFIX, "match_failed", { wanted: name });
    return {
      parserId: PARSER_ID,
      laps: [],
      candidates: [],
      message: "User's name not found",
      errorCode: "driver_not_found",
    };
  }

  console.info(LOG_PREFIX, "matched_row", {
    driverName: matched.driverName,
    driverId: matched.driverId,
  });

  const $page = load(mainFetch.text);
  const lapsLink = $page("a.driver_laps").filter((_, el) => $page(el).attr("data-driver-id") === matched.driverId);
  const resultRow = lapsLink.first().closest("tr").get(0) ?? null;
  const displayedFastest = resultRow ? extractDisplayedFastestLapFromResultRow($page, resultRow) : null;

  let rawLaps: number[] = [];
  let extractStrategy = "none";
  let usedUrl: string | null = null;

  const embed = tryExtractLapsFromRacerLapsEmbed(mainFetch.text, matched.driverId);
  if (embed && embed.laps.length > 0) {
    rawLaps = embed.laps;
    extractStrategy = "racer_laps_embed";
    usedUrl = "embed:racerLaps";

    const fastestExtracted = Math.min(...rawLaps);
    console.info(LOG_PREFIX, "racer_laps_embed_ok", {
      matchedName: matched.driverName,
      driverId: matched.driverId,
      racerLapsKeys: embed.keys,
      lapCount: rawLaps.length,
      firstFive: rawLaps.slice(0, 5),
      displayedFastest,
      fastestExtracted,
    });

    if (displayedFastest != null) {
      const diff = Math.abs(fastestExtracted - displayedFastest);
      if (diff > 0.06) {
        console.warn(LOG_PREFIX, "fastest_lap_mismatch", {
          fastestExtracted,
          displayedFastest,
          diff,
        });
      }
    }
  }

  if (rawLaps.length === 0) {
    console.info(LOG_PREFIX, "import_abort", {
      driverId: matched.driverId,
      hadRacerLapsScript: pageHtmlContainsRacerLaps(mainFetch.text),
    });
    return {
      parserId: PARSER_ID,
      laps: [],
      candidates: [],
      message: "Could not parse embedded racerLaps for this driver. Check server logs for embed_fail details.",
      errorCode: "racer_laps_embed_failed",
      sessionHint: { name: null, className: "racer_laps_embed_failed" },
    };
  }

  console.info(LOG_PREFIX, "laps_extracted", {
    strategy: extractStrategy,
    firstFive: rawLaps.slice(0, 5),
    total: rawLaps.length,
    resolvedDriverId: matched.driverId,
  });

  const lapRows = markMedianOutlierWarnings(rawLaps, 0.3);
  const laps = lapRows.map((r) => r.time);

  return {
    parserId: PARSER_ID,
    laps,
    lapRows,
    candidates: [
      {
        id: "liverc_race_driver",
        label: `${matched.driverName} (LiveRC race result)`,
        laps,
        roleHint: "primary",
      },
    ],
    message: `Imported ${laps.length} laps for ${matched.driverName}.`,
    sessionHint: { name: null, className: `${extractStrategy}|${usedUrl}` },
  };
}
