import "server-only";

import { prisma } from "@/lib/prisma";
import { fetchUrlText } from "@/lib/lapUrlParsers/fetchText";
import {
  enumerateMyRcmSessions,
  isMyRcmCategoryUrl,
  isMyRcmEventUrl,
  myRcmClassMatchesConfigured,
  parseMyRcmEventClasses,
  parseMyRcmReportUrl,
  type MyRcmSessionLink,
} from "@/lib/lapUrlParsers/myRcmReport";

/** Keep an event-wide scan bounded: at most this many class shells are fetched. */
const MAX_CLASS_SHELLS = 5;
/** Row cap mirrors the LiveRC results-scan cap. */
const MAX_CANDIDATE_ROWS = 80;

export type MyRcmDayCandidate = {
  sessionId: string;
  sessionUrl: string;
  /** Display label, e.g. "E10 TC SPEC · Qualy · Heat 2 - Qualy 1". */
  label: string;
  alreadyImported: boolean;
  linkedRunId: string | null;
};

export type DiscoverMyRcmDaySessionsResult = {
  candidates: MyRcmDayCandidate[];
  totalSessions: number;
  classNames: string[];
  classFilterApplied: boolean;
  scanMessage: string | null;
};

function candidateLabel(className: string | null, s: MyRcmSessionLink): string {
  const parts = [className, s.group, s.label].filter(Boolean);
  return parts.join(" · ");
}

/**
 * Enumerate a MyRCM event's (or single class's) result sessions for the log-run lap picker.
 * Paste-per-event flow: the user supplies the event URL (`main?…dId[E]=…`) or a class report URL;
 * we list every Free practice / Practice / Qualy / Final session so they can pick the one they raced.
 * Each candidate's `sessionUrl` is a single-session import URL handled by the MyRCM parser.
 */
export async function discoverMyRcmDaySessions(input: {
  userId: string;
  url: string;
  eventRaceClass?: string | null;
}): Promise<DiscoverMyRcmDaySessionsResult> {
  const url = input.url.trim();
  const configuredClass = input.eventRaceClass?.trim() || null;

  // Resolve to one or more category (class) report URLs.
  let classes: Array<{ categoryUrl: string; className: string | null }> = [];
  let classFilterApplied = false;

  if (isMyRcmEventUrl(url)) {
    const eventPage = await fetchUrlText(url);
    if (!eventPage.ok) {
      return {
        candidates: [],
        totalSessions: 0,
        classNames: [],
        classFilterApplied: false,
        scanMessage: `Could not load this MyRCM event page: ${eventPage.error}`,
      };
    }
    let eventClasses = parseMyRcmEventClasses(eventPage.text);
    if (eventClasses.length === 0) {
      return {
        candidates: [],
        totalSessions: 0,
        classNames: [],
        classFilterApplied: false,
        scanMessage: "No classes found on this MyRCM event page. Results may not be published yet.",
      };
    }
    if (configuredClass) {
      const narrowed = eventClasses.filter((c) => myRcmClassMatchesConfigured(c.className, configuredClass));
      if (narrowed.length > 0) {
        eventClasses = narrowed;
        classFilterApplied = true;
      }
    }
    classes = eventClasses
      .slice(0, MAX_CLASS_SHELLS)
      .map((c) => ({ categoryUrl: c.categoryUrl, className: c.className }));
  } else if (isMyRcmCategoryUrl(url)) {
    classes = [{ categoryUrl: url, className: null }];
  } else {
    return {
      candidates: [],
      totalSessions: 0,
      classNames: [],
      classFilterApplied: false,
      scanMessage: "Unsupported MyRCM URL.",
    };
  }

  // Fetch each class shell and enumerate its sessions (menu is static HTML — one GET per class).
  const perClass = await Promise.all(
    classes.map(async (cls) => {
      const ref = parseMyRcmReportUrl(cls.categoryUrl);
      if (!ref) return { className: cls.className, sessions: [] as MyRcmSessionLink[] };
      const shell = await fetchUrlText(cls.categoryUrl);
      if (!shell.ok) return { className: cls.className, sessions: [] as MyRcmSessionLink[] };
      return { className: cls.className, sessions: enumerateMyRcmSessions(shell.text, ref) };
    })
  );

  const rows: MyRcmDayCandidate[] = [];
  for (const cls of perClass) {
    for (const s of cls.sessions) {
      rows.push({
        sessionId: `myrcm-${s.reportKey}-${rows.length}`,
        sessionUrl: s.url,
        label: candidateLabel(cls.className, s),
        alreadyImported: false,
        linkedRunId: null,
      });
    }
  }
  const totalSessions = rows.length;

  // Mark rows the user already imported (and any run linkage) — same pattern as the LiveRC scan.
  const urls = rows.map((r) => r.sessionUrl);
  const existing = urls.length
    ? await prisma.importedLapTimeSession.findMany({
        where: { userId: input.userId, sourceUrl: { in: urls } },
        select: { sourceUrl: true, linkedRunId: true },
      })
    : [];
  const importedMap = new Map<string, string | null>();
  for (const r of existing) importedMap.set(r.sourceUrl.trim(), r.linkedRunId);
  for (const r of rows) {
    if (importedMap.has(r.sessionUrl)) {
      r.alreadyImported = true;
      r.linkedRunId = importedMap.get(r.sessionUrl) ?? null;
    }
  }

  const capped = rows.slice(0, MAX_CANDIDATE_ROWS);
  const classNames = perClass.map((c) => c.className).filter((n): n is string => Boolean(n));

  let scanMessage: string | null = null;
  if (totalSessions === 0) {
    scanMessage = "No result sessions found on this MyRCM page yet.";
  } else if (totalSessions > capped.length) {
    scanMessage = `Showing first ${capped.length} of ${totalSessions} sessions — set the event's race class to narrow, or paste your class's results URL directly.`;
  }

  return { candidates: capped, totalSessions, classNames, classFilterApplied, scanMessage };
}
