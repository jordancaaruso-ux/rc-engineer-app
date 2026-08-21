/**
 * MyRCM (myrcm.ch) lap source — v9 site (see `myRcmReport.ts` for the page contracts).
 *
 * Two jobs, chosen by whether the URL names a single run:
 *  - **Event or class URL** → enumerate the runs on the page so the driver picks the one they raced.
 *    On v9 an event URL is no longer a dead end: MyRCM renders the event's first class there, so the
 *    same enumeration works and we can name the other classes instead of sending the driver away.
 *  - **Single run URL** (`?reportKey=<n>`) → read the **whole field** into `sessionDrivers`.
 *
 * The field is the reason this parser exists. A Speedhive practice activity is one driver's own
 * session, so it can never answer "how did I compare"; a MyRCM run page carries every driver, which
 * is what pace-vs-field and the Engineer's rival context are built on.
 *
 * MyRCM has no per-driver account or id, so the driver's own row is found by name. When it cannot be
 * found we import the field and return the rows as candidates — deliberately **not** falling through
 * to the first row, which is the session winner, not the user.
 */

import type { LapUrlParseContext, LapUrlParseResult, LapUrlParser, LapUrlSessionDriver } from "./types";
import { fetchUrlText } from "./fetchText";
import { markMedianOutlierWarnings } from "./livercRaceResult";
import {
  buildMyRcmEventUrl,
  buildMyRcmSessionUrl,
  enumerateMyRcmSessions,
  isMyRcmEventUrl,
  isMyRcmReportUrl,
  legacyMyRcmEventIdFromUrl,
  parseMyRcmEventClasses,
  parseMyRcmReportUrl,
  parseMyRcmSelectedClassName,
  parseMyRcmSessionHtml,
  type MyRcmReportRef,
} from "./myRcmReport";

const PARSER_ID = "myrcm_report_v1";
const LOG_PREFIX = "[myrcm-import]";

function normalizeForMatch(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Every name the driver may appear under on MyRCM, most specific first. */
function candidateNames(context?: LapUrlParseContext): string[] {
  const out: string[] = [];
  for (const n of [...(context?.myRcmDriverNames ?? []), context?.driverName]) {
    const norm = n ? normalizeForMatch(n) : "";
    if (norm && !out.includes(norm)) out.push(norm);
  }
  return out;
}

/**
 * Find the driver's own row. Returns null rather than guessing.
 *
 * MyRCM writes names in both directions ("Hansruedi Baer", "Baer Hansruedi"), so an exact match is
 * tried first, then a token-set match, then a unique surname. Anything ambiguous returns null and
 * the caller asks the driver to pick.
 */
function findOwnRow(
  drivers: LapUrlSessionDriver[],
  names: string[]
): LapUrlSessionDriver | null {
  for (const want of names) {
    const exact = drivers.find((d) => d.normalizedName === want);
    if (exact) return exact;

    const wantTokens = want.split(" ").filter(Boolean);
    if (wantTokens.length > 1) {
      const sameTokens = drivers.filter((d) => {
        const has = new Set(d.normalizedName.split(" ").filter(Boolean));
        return wantTokens.length === has.size && wantTokens.every((t) => has.has(t));
      });
      if (sameTokens.length === 1) return sameTokens[0]!;
    }

    const surname = wantTokens[wantTokens.length - 1] ?? "";
    if (surname.length >= 3) {
      const bySurname = drivers.filter((d) => d.normalizedName.split(" ").includes(surname));
      if (bySurname.length === 1) return bySurname[0]!;
    }
  }
  return null;
}

function buildCandidates(
  drivers: LapUrlSessionDriver[],
  ownId: string | null
): NonNullable<LapUrlParseResult["candidates"]> {
  return drivers.map((d) => ({
    id: d.id,
    label: `${d.driverName} · ${d.lapCount ?? d.laps.length} laps`,
    laps: d.laps,
    roleHint: d.id === ownId ? ("primary" as const) : ("competitor" as const),
  }));
}

/** Event and class pages enumerate identically on v9 — only the "other classes" line differs. */
async function parseDiscovery(url: string, ref: MyRcmReportRef): Promise<LapUrlParseResult> {
  const fetched = await fetchUrlText(url);
  if (!fetched.ok) {
    return { parserId: PARSER_ID, laps: [], candidates: [], message: fetched.error, errorCode: "fetch_failed" };
  }

  const sessions = enumerateMyRcmSessions(fetched.text, ref);
  const classes = parseMyRcmEventClasses(fetched.text, ref.eventId);
  const shownClass = parseMyRcmSelectedClassName(fetched.text);

  if (sessions.length === 0) {
    const classHint =
      classes.length > 1
        ? ` This event has ${classes.length} classes — open the one you raced and paste that URL.`
        : "";
    return {
      parserId: PARSER_ID,
      laps: [],
      candidates: [],
      discoveredSessions: [],
      message: `No result runs found on this MyRCM page.${classHint}`,
      errorCode: "myrcm_category_empty",
    };
  }

  const withResults = sessions.filter((s) => s.hasResults);
  const pending = sessions.length - withResults.length;
  // A pending run imports as an empty session, so offer the ones that actually have times.
  const offered = withResults.length > 0 ? withResults : sessions;

  const classLabel = shownClass ? `${shownClass}: ` : "";
  const pendingHint = pending > 0 ? ` ${pending} more haven't been run yet.` : "";
  const otherClasses =
    classes.length > 1
      ? ` Racing a different class? This event has ${classes.length}: ${classes
          .map((c) => c.className)
          .slice(0, 6)
          .join(", ")}.`
      : "";

  console.info(LOG_PREFIX, "discovery_enumerated", {
    total: sessions.length,
    withResults: withResults.length,
    classes: classes.length,
  });

  return {
    parserId: PARSER_ID,
    laps: [],
    candidates: [],
    discoveredSessions: offered.map((s) => ({ url: s.url, label: s.label, group: s.group })),
    message: `${classLabel}${offered.length} run${offered.length === 1 ? "" : "s"} with results — pick the one you raced.${pendingHint}${otherClasses}`,
    errorCode: "myrcm_category",
  };
}

async function parseSession(
  url: string,
  ref: MyRcmReportRef,
  context?: LapUrlParseContext
): Promise<LapUrlParseResult> {
  // Normalize first: MyRCM's own legacy→v9 redirect drops the query string, so following it would
  // silently lose the reportKey and land us on the class page.
  const canonical = buildMyRcmSessionUrl(ref, ref.reportKey!);
  const fetched = await fetchUrlText(canonical);
  if (!fetched.ok) {
    return { parserId: PARSER_ID, laps: [], candidates: [], message: fetched.error, errorCode: "fetch_failed" };
  }

  const { meta, drivers, lapCountsAgree } = parseMyRcmSessionHtml(fetched.text);
  const driversWithLaps = drivers.filter((d) => d.laps.length > 0);

  if (driversWithLaps.length === 0) {
    return {
      parserId: PARSER_ID,
      laps: [],
      candidates: [],
      sessionDrivers: drivers,
      sessionHint: { name: meta.sessionName ?? null, className: meta.className ?? null },
      message:
        drivers.length > 0
          ? "This MyRCM run has no lap times yet — it may not have been run."
          : "Could not read lap times from this MyRCM run.",
      errorCode: "myrcm_no_laps",
    };
  }

  const names = candidateNames(context);
  const own = findOwnRow(driversWithLaps, names);
  const ordered = own ? [own, ...driversWithLaps.filter((d) => d.id !== own.id)] : driversWithLaps;

  console.info(LOG_PREFIX, "session_loaded", {
    drivers: driversWithLaps.length,
    matchedOwnRow: Boolean(own),
    hadNameToMatch: names.length > 0,
    lapCountsAgree,
    when: meta.startTimeIso,
  });

  const shared = {
    parserId: PARSER_ID,
    sessionDrivers: ordered,
    candidates: buildCandidates(ordered, own?.id ?? null),
    sessionHint: { name: meta.sessionName ?? null, className: meta.className ?? null },
    sessionCompletedAtIso: meta.startTimeIso,
  } satisfies Partial<LapUrlParseResult>;

  // No confident match: keep the field (that is the valuable half) but do not hand back the first
  // row, which is the winner. The picker below already lets the driver choose their own.
  if (!own) {
    const reason = names.length
      ? `We couldn't find your name in this MyRCM run.`
      : `MyRCM doesn't say which row is yours.`;
    const fix = names.length
      ? ` Pick your row below, or check Settings → Name on MyRCM.`
      : ` Pick your row below, or set Settings → Name on MyRCM to have it chosen for you.`;
    return {
      ...shared,
      laps: [],
      message: `${reason}${fix} All ${driversWithLaps.length} drivers were imported for comparison.`,
      errorCode: "myrcm_no_driver_match",
    };
  }

  const lapRows = markMedianOutlierWarnings(own.laps, 0.3);
  const joinWarning = lapCountsAgree
    ? ""
    : " Lap counts didn't line up with MyRCM's own classification — check your laps before saving.";

  return {
    ...shared,
    laps: lapRows.map((r) => r.time),
    lapRows,
    message: `Imported ${own.driverName} — ${own.laps.length} laps, and ${
      driversWithLaps.length - 1
    } other driver${driversWithLaps.length - 1 === 1 ? "" : "s"} for comparison.${joinWarning}`,
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
      let ref = parseMyRcmReportUrl(trimmed);

      // Legacy landing page (`/myrcm/main?…dId[E]=…`) — MyRCM now redirects it to its homepage and
      // loses the id, so rebuild the v9 event URL from the id ourselves.
      if (!ref) {
        const legacyEventId = legacyMyRcmEventIdFromUrl(trimmed);
        if (legacyEventId) {
          const eventUrl = buildMyRcmEventUrl(legacyEventId);
          ref = parseMyRcmReportUrl(eventUrl);
          if (ref) return await parseDiscovery(eventUrl, ref);
        }
      }

      if (!ref) {
        return { parserId: PARSER_ID, laps: [], candidates: [], message: "Unsupported MyRCM URL.", errorCode: "unsupported_url" };
      }
      return ref.reportKey ? parseSession(trimmed, ref, context) : parseDiscovery(trimmed, ref);
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
