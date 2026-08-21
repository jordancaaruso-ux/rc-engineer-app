/**
 * What the lap-times card says when the picker has nothing to list, and which buttons it offers.
 *
 * Its own module because this is the part worth testing: each state names the most likely cause
 * first and offers the fix as something pressable, and the ordering rule that matters — never send
 * a driver to Settings over a track that has published nothing — is a claim about copy, not about
 * rendering. Kept free of React so it can be run directly.
 */
import {
  SOURCE_LABELS,
  type LapDiscoveryStatus,
  type LapTimingSource,
} from "@/lib/lapWatch/lapDiscoveryStatus";

/** Empty-state headline, detail line, and the buttons that can actually fix it. */
export type ScanStatusAction =
  | { kind: "settings" }
  | { kind: "retry" }
  | { kind: "paste" }
  | { kind: "track" }
  | { kind: "timingPage"; url: string; source: LapTimingSource };
export type ScanStatus = { title: string; detail: string | null; actions: ScanStatusAction[] };

/**
 * Which day the scanned list is actually from, in the viewer's own zone.
 *
 * Done on the client on purpose: the server sees only the club's date string and has no idea what
 * day it is where the driver is standing.
 */
export function describePostedDay(dayIso: string | null | undefined): { isToday: boolean; label: string } | null {
  const raw = dayIso?.trim();
  if (!raw) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!parts) return null;
  const day = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  if (Number.isNaN(day.getTime())) return null;
  const now = new Date();
  const isToday =
    day.getFullYear() === now.getFullYear() &&
    day.getMonth() === now.getMonth() &&
    day.getDate() === now.getDate();
  return {
    isToday,
    label: day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }),
  };
}

function sourceNames(sources: LapTimingSource[]): string {
  const names = sources.map((s) => SOURCE_LABELS[s]);
  if (names.length === 0) return "the timing site";
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** At most one door per site, in the order they were scanned. */
function timingPageActions(status: LapDiscoveryStatus): ScanStatusAction[] {
  const seen = new Set<string>();
  const out: ScanStatusAction[] = [];
  for (const page of status.timingPages) {
    if (seen.has(page.source)) continue;
    seen.add(page.source);
    out.push({ kind: "timingPage", url: page.url, source: page.source });
  }
  return out;
}

/**
 * What the card says when the picker has nothing to list.
 *
 * Each state names the most likely cause first and offers the fix as a button. The ordering rule
 * that matters: never send a driver to Settings over a track that has published nothing. Timing
 * lags the track by a few minutes, so "it isn't up yet" is the common case and "your name is wrong"
 * is the rarer one — said the other way round, the card sends people to fix what isn't broken.
 */
export function resolveScanStatus(opts: {
  status: LapDiscoveryStatus | null;
  scanMessage: string | null;
  totalCandidates: number;
  unimportedCount: number;
  candidateCount: number;
  olderCount: number;
  importedCount: number;
}): ScanStatus | null {
  const {
    status,
    scanMessage,
    totalCandidates,
    unimportedCount,
    candidateCount,
    olderCount,
    importedCount,
  } = opts;

  if (candidateCount > 0) return null;

  if (status) {
    const names = sourceNames(status.sources);
    const pages = timingPageActions(status);
    const posted = status.postedCount;
    switch (status.code) {
      case "no_identity":
        return {
          title: "Add your timing details so laps attach on their own",
          detail: `We need your driver name and transponder number to pick your sessions out of ${names}.`,
          actions: [{ kind: "settings" }, ...pages],
        };
      case "no_match": {
        const day = describePostedDay(status.postedDayIso);
        // Nothing from today at all: the site answered with an older day's list. Said as "posted
        // today, none yours" this reads as an accusation about your name, when the truth is the
        // club hasn't uploaded today yet — a driver who has just come off the track needs to know
        // which of those two it is.
        if (day && !day.isToday) {
          return {
            title: "Nothing posted at this track yet today",
            detail: `The most recent sessions here are from ${day.label}${posted > 0 ? ` — ${posted} of them, none matched you` : ""}. Timing usually appears a few minutes after a run finishes.`,
            actions: [{ kind: "retry" }, ...pages],
          };
        }
        // A club that publishes results without a transponder column can't be matched on the
        // number, so pointing at it would be a dead end.
        const detail = status.transponderNotPublished
          ? "This club publishes results without transponder numbers, so we can only go on your name. Check the name you appear under in Settings, or take yours from the list."
          : "Yours might not be uploaded yet. If it should be up by now, check your name and transponder number in Settings match what the timing screen prints.";
        return {
          title:
            posted > 0
              ? // "today" only when the scan actually dated the list. Where a source hands back a
                // recent-activity list with no day on it, claiming today is a guess the driver
                // would have to disprove by opening the site themselves.
                `${posted} session${posted === 1 ? "" : "s"} posted ${day ? "today" : "here"} — none matched you`
              : `Nothing here matched you on ${names}`,
          detail,
          actions: [{ kind: "settings" }, ...pages],
        };
      }
      case "nothing_posted":
        return {
          title: "Nothing posted at this track yet",
          detail:
            "Timing usually appears a few minutes after a run finishes. If it's been longer than that, the track may not have uploaded today's sessions.",
          actions: [{ kind: "retry" }, ...pages],
        };
      case "unreachable":
        return {
          title: `Couldn't reach ${names} just now`,
          detail: "It can get busy during a live meeting. Try again in a minute, or paste a link straight to your session.",
          actions: [{ kind: "retry" }, ...pages, { kind: "paste" }],
        };
      case "all_imported":
        return {
          title: "Nothing new to import",
          detail:
            importedCount > 0
              ? `The ${importedCount} session${importedCount === 1 ? "" : "s"} found for you here ${importedCount === 1 ? "is" : "are"} already in. ${importedCount === 1 ? "It's" : "They're"} below if you want ${importedCount === 1 ? "it" : "one"} again.`
              : `Everything found for you here is already imported.`,
          actions: pages,
        };
      case "no_timing_page":
        return {
          title: "This track has no timing page saved",
          detail:
            "Add its LiveRC or MYLAPS page once and we'll look there every time you log a run here.",
          actions: [{ kind: "track" }, { kind: "paste" }],
        };
      case "invalid_url":
        return {
          title: "This track's timing link isn't one we can scan",
          detail: "Check the link saved on the track, or paste a link straight to your session.",
          actions: [{ kind: "track" }, { kind: "paste" }],
        };
    }
  }

  // No structured state — a pasted MyRCM event or a source that still speaks in sentences.
  if (scanMessage) return { title: scanMessage, detail: null, actions: [] };
  if (olderCount > 0) {
    return {
      title: "No sessions from today yet",
      detail: `${olderCount} older session${olderCount === 1 ? "" : "s"} available below.`,
      actions: [],
    };
  }
  if (totalCandidates > 0 && unimportedCount === 0) {
    const n = totalCandidates;
    return {
      title: "No new sessions to import",
      detail: `Found ${n} session${n === 1 ? "" : "s"} for your driver — all already imported.`,
      actions: [],
    };
  }
  return { title: "No new sessions to import", detail: null, actions: [] };
}
