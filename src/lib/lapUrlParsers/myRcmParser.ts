/**
 * MyRCM (myrcm.ch) lap source.
 *
 * Two URL shapes, both handled here:
 *  - Category (class) URL `…/report/en/<event>/<category>` → the page is a JS shell; we enumerate its
 *    result sessions (Free practice / Practice / Qualy / Final) and return them for the user to pick.
 *  - Single-session URL `…?reportKey=<n>` → fetch the fragment and parse the full field (all drivers)
 *    into `sessionDrivers`, mirroring the LiveRC race-result contract.
 *
 * Unlike LiveRC/Speedhive there is no per-driver id or account, and MyRCM's own address bar never
 * exposes a per-session URL (navigation is AJAX), so the category→pick-session flow is required.
 */

import type { LapUrlParseContext, LapUrlParseResult, LapUrlParser, LapUrlSessionDriver } from "./types";
import { fetchUrlText } from "./fetchText";
import { markMedianOutlierWarnings } from "./livercRaceResult";
import {
  buildMyRcmSessionUrl,
  enumerateMyRcmSessions,
  isMyRcmEventUrl,
  isMyRcmReportUrl,
  parseMyRcmReportUrl,
  parseMyRcmSessionHtml,
} from "./myRcmReport";

const PARSER_ID = "myrcm_report_v1";
const LOG_PREFIX = "[myrcm-import]";

function normalizeForMatch(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Prefer the row matching the user's configured name; else the classification winner (first row). */
function pickPrimary(drivers: LapUrlSessionDriver[], contextName?: string): LapUrlSessionDriver {
  const want = contextName ? normalizeForMatch(contextName) : "";
  if (want) {
    const exact = drivers.find((d) => d.normalizedName === want);
    if (exact) return exact;
    // surname-only fallback when unambiguous
    const surname = want.split(" ").filter(Boolean).pop() ?? "";
    if (surname.length >= 2) {
      const bySurname = drivers.filter((d) => d.normalizedName.split(" ").pop() === surname);
      if (bySurname.length === 1) return bySurname[0]!;
    }
  }
  return drivers[0]!;
}

function buildCandidates(drivers: LapUrlSessionDriver[]): NonNullable<LapUrlParseResult["candidates"]> {
  return drivers.map((d) => ({
    id: d.id,
    label: `${d.driverName} · ${d.lapCount ?? d.laps.length} laps`,
    laps: d.laps,
    roleHint: "competitor" as const,
  }));
}

async function parseCategory(url: string): Promise<LapUrlParseResult> {
  const ref = parseMyRcmReportUrl(url);
  if (!ref) {
    return { parserId: PARSER_ID, laps: [], candidates: [], message: "Unsupported MyRCM URL.", errorCode: "unsupported_url" };
  }
  const shell = await fetchUrlText(url);
  if (!shell.ok) {
    return { parserId: PARSER_ID, laps: [], candidates: [], message: shell.error, errorCode: "fetch_failed" };
  }
  const sessions = enumerateMyRcmSessions(shell.text, ref);
  if (sessions.length === 0) {
    return {
      parserId: PARSER_ID,
      laps: [],
      candidates: [],
      discoveredSessions: [],
      message: "No result sessions found on this MyRCM class page.",
      errorCode: "myrcm_category_empty",
    };
  }
  console.info(LOG_PREFIX, "category_enumerated", { count: sessions.length });
  return {
    parserId: PARSER_ID,
    laps: [],
    candidates: [],
    discoveredSessions: sessions.map((s) => ({ url: s.url, label: `${s.group} · ${s.label}`, group: s.group })),
    message: `This MyRCM class has ${sessions.length} result session(s). Pick the one you raced.`,
    errorCode: "myrcm_category",
  };
}

async function parseSession(url: string, context?: LapUrlParseContext): Promise<LapUrlParseResult> {
  const ref = parseMyRcmReportUrl(url);
  if (!ref || !ref.reportKey) {
    return { parserId: PARSER_ID, laps: [], candidates: [], message: "Unsupported MyRCM session URL.", errorCode: "unsupported_url" };
  }
  // Normalize to the canonical single-session URL (drops extraneous params / fragment).
  const canonical = buildMyRcmSessionUrl(ref, ref.reportKey);
  const fetched = await fetchUrlText(canonical);
  if (!fetched.ok) {
    return { parserId: PARSER_ID, laps: [], candidates: [], message: fetched.error, errorCode: "fetch_failed" };
  }

  const { meta, drivers } = parseMyRcmSessionHtml(fetched.text);
  const driversWithLaps = drivers.filter((d) => d.laps.length > 0);
  if (driversWithLaps.length === 0) {
    return {
      parserId: PARSER_ID,
      laps: [],
      candidates: [],
      sessionDrivers: drivers,
      sessionHint: { name: null, className: meta.className ?? null },
      message: "Could not read lap times from this MyRCM session.",
      errorCode: "myrcm_no_laps",
    };
  }

  const primary = pickPrimary(driversWithLaps, context?.driverName);
  const ordered = [primary, ...driversWithLaps.filter((d) => d.id !== primary.id)];
  const lapRows = markMedianOutlierWarnings(primary.laps, 0.3);
  const laps = lapRows.map((r) => r.time);

  console.info(LOG_PREFIX, "session_loaded", {
    drivers: driversWithLaps.length,
    primary: primary.driverName,
    primaryLaps: primary.laps.length,
    className: meta.className,
    when: meta.startTimeIso,
  });

  return {
    parserId: PARSER_ID,
    laps,
    lapRows,
    sessionDrivers: ordered,
    candidates: buildCandidates(ordered),
    sessionHint: { name: null, className: meta.className ?? null },
    sessionCompletedAtIso: meta.startTimeIso,
    message: `Imported MyRCM session with ${driversWithLaps.length} drivers. Select one or more drivers below.`,
  };
}

export const myRcmParser: LapUrlParser = {
  id: PARSER_ID,

  canHandle(url: string): boolean {
    return isMyRcmReportUrl(url) || isMyRcmEventUrl(url);
  },

  async parse(url: string, context?: LapUrlParseContext): Promise<LapUrlParseResult> {
    const trimmed = url.trim();
    try {
      if (isMyRcmEventUrl(trimmed)) {
        return {
          parserId: PARSER_ID,
          laps: [],
          candidates: [],
          message:
            "This is a MyRCM event page (all classes). Open the class you raced, then copy that results URL (myrcm.ch/myrcm/report/…) and paste it here.",
          errorCode: "myrcm_event_page",
        };
      }
      const ref = parseMyRcmReportUrl(trimmed);
      if (!ref) {
        return { parserId: PARSER_ID, laps: [], candidates: [], message: "Unsupported MyRCM URL.", errorCode: "unsupported_url" };
      }
      return ref.reportKey ? parseSession(trimmed, context) : parseCategory(trimmed);
    } catch (e) {
      console.info(LOG_PREFIX, "error", { err: e instanceof Error ? e.message : String(e) });
      return {
        parserId: PARSER_ID,
        laps: [],
        candidates: [],
        message: e instanceof Error ? e.message : "Failed to parse MyRCM URL.",
        errorCode: "myrcm_parse_error",
      };
    }
  },
};
