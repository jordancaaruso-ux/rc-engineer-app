import { calendarYmdInTimeZone, formatRunDateWeekday, formatRunTimeOnly } from "@/lib/formatDate";
import { sessionUtcOffsetMinutesFromImportedPayload } from "@/lib/lapImport/fromPayload";
import {
  importedSessionTimeForDisplay,
  resolveImportedSessionDisplayTimeIso,
  resolveImportedSessionHasWallClockTime,
  timingSourceFromParserId,
  timingSourceFromSourceUrl,
} from "@/lib/lapImport/labels";
import { isOnlyADate, usable } from "@/lib/lapImport/sessionTitle";
import { MYRCM_PDF_SOURCE_PREFIX } from "@/lib/lapUrlParsers/myRcmPdfSource";
import { importedSessionIsPractice, practiceColumnName } from "@/lib/practiceField/practiceField";
import type { KnownCompetitor } from "@/lib/speedhive/knownCompetitors";
import { normalizeSpeedhiveTransponderNumber } from "@/lib/speedhive/speedhiveTransponder";

/**
 * What an imported timing session is called in the Laptime Analysis lists and on its own page.
 *
 * Founder call, 2026-09-23, off a phone screenshot of three rows all reading "Imported session":
 * a session is named for WHOSE it is, WHERE and WHEN, and which run of the day — "13.5 Touring
 * makes no sense". The class a practice sheet prints said nothing about which of three sessions
 * was which. So:
 *
 *   - practice: "Jordan Caruso · Run 3" — the driver, then their position in the day;
 *   - a race you're on: "Jordan Caruso · Qualifier 2" — races keep their own name, never a run
 *     number (his call), the same way the Sessions list names a run;
 *   - a race you're not on: just the race, "ISTC Modified A3-Main".
 *
 * Where and when are not in the name: lists file sessions under a "Tue 22 Sept · Chargers RC"
 * heading and print the time on the row (option B off the naming board). A name the driver
 * typed replaces the automatic one and nothing else.
 *
 * "Run 3" is a POSITION, counted over every session held for that driver at that track that day
 * — the 2026-08-25 ruling that position is the one thing certainly true, and that the app must
 * not guess at an event's timetable ("Practice 3"). The caller hands in the whole day, deleted
 * sessions included: they still happened, and deleting run 2 must not turn run 3 into run 2.
 *
 * Pure, so the server (Tools card, the session page) and the browser (the library) agree.
 */

export type SessionNamingRow = {
  id: string;
  createdAt: string;
  sessionCompletedAt?: string | null;
  sourceUrl: string;
  parserId: string;
  parsedPayload?: unknown;
  eventDetectionSource?: string | null;
  eventDetectionSessionLabel?: string | null;
  eventRaceClass?: string | null;
  customName?: string | null;
  /** Resolved by the loader: the sweep's track, a linked run's or event's, or the club's own site. */
  trackName?: string | null;
  /** The viewer's transponder the sweep found this session by. Found that way, it is theirs. */
  sweepChipCode?: string | null;
};

export type SessionNamingViewer = {
  /** Every spelling timing prints the viewer under. Multi-line settings may be passed whole. */
  names: readonly string[];
  /** How the viewer is written on their own sessions — "Jordan Caruso". */
  displayName: string | null;
  /** The viewer's own transponders. */
  transponders: readonly (string | number)[];
  /** "Drivers you know": what the viewer calls a chip, for MYLAPS practice that names nobody. */
  saved: readonly KnownCompetitor[];
};

export type SessionName = {
  id: string;
  /** What the row and the page title say: the driver's own name for it, else the automatic one. */
  title: string;
  /** The automatic name, kept when renamed so the page can still say what it was. */
  autoTitle: string;
  isCustom: boolean;
  isRace: boolean;
  /** Whose session: the viewer, the practice driver, or null on a race the viewer wasn't in. */
  who: string | null;
  isViewer: boolean;
  /** Practice only: that driver's Nth time on track that day at that track. */
  runNumber: number | null;
  /** The track, or the timing site when no track could be matched. */
  place: string;
  /** Calendar day of the session on the track's clock, YYYY-MM-DD. */
  dayKey: string;
  /** "Tue 22 Sept" — the year only when it isn't this year. */
  dayLabel: string;
  /** "7:48 PM" on the track's clock. Null when the timing site gave no time at all. */
  timeLabel: string | null;
  /** The list heading this session files under, and its key. */
  groupKey: string;
  groupLabel: string;
  /** Entrants with laps. */
  driverCount: number;
  /** A race's second line: its class when the name leaves it out, and how many drove. */
  detail: string | null;
  /** Ordering within a day. Track-clock milliseconds when on-track time is known. */
  sortMs: number;
};

/** Longest name a driver can type for a session. */
export const SESSION_CUSTOM_NAME_MAX = 80;

/** Two copies of one outing (the same race on two timing sites) sit within this of each other. */
const SAME_OUTING_MS = 2 * 60 * 1000;

type SheetDriver = { name: string; lapCount: number };

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Every name the viewer goes by, one per entry — the LiveRC setting holds one name per line. */
function viewerNameSet(names: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of names) {
    for (const line of String(raw ?? "").split(/\r?\n/)) {
      const n = normalizeName(line);
      if (n) out.add(n);
    }
  }
  return out;
}

function chipSet(chips: readonly (string | number)[]): Set<string> {
  const out = new Set<string>();
  for (const c of chips) {
    const n = normalizeSpeedhiveTransponderNumber(c);
    if (n) out.add(n);
  }
  return out;
}

function sheetDrivers(parsedPayload: unknown): SheetDriver[] {
  if (!parsedPayload || typeof parsedPayload !== "object") return [];
  const list = (parsedPayload as { sessionDrivers?: unknown }).sessionDrivers;
  if (!Array.isArray(list)) return [];
  const out: SheetDriver[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const d = raw as { driverName?: unknown; laps?: unknown; lapCount?: unknown };
    const lapCount = Array.isArray(d.laps)
      ? d.laps.length
      : typeof d.lapCount === "number"
        ? d.lapCount
        : 0;
    if (lapCount <= 0) continue;
    out.push({ name: typeof d.driverName === "string" ? d.driverName.trim() : "", lapCount });
  }
  return out;
}

function sessionHint(parsedPayload: unknown): Record<string, unknown> {
  if (!parsedPayload || typeof parsedPayload !== "object") return {};
  const h = (parsedPayload as { sessionHint?: unknown }).sessionHint;
  return h && typeof h === "object" ? (h as Record<string, unknown>) : {};
}

function hintText(hint: Record<string, unknown>, key: string): string | null {
  const v = hint[key];
  return typeof v === "string" ? usable(v) : null;
}

/** A driver name worth printing: not blank, not a parser marker, not a timestamp. */
function personName(raw: string | null | undefined): string | null {
  const v = usable(raw);
  if (!v || isOnlyADate(v)) return null;
  return v;
}

/**
 * A race's own name.
 *
 * LiveRC's page title carries the full name ("ISTC Modified A3-Main") and the parser keeps it as
 * the hint's class; MyRCM keeps the session ("Heat 25 Qualy 2") and the class apart. The hint's
 * `name` is only a session name on MyRCM — on MYLAPS it is a matched DRIVER, so it is never read
 * here for anyone else. The event-detection label is the results list's link text, "Race 15:
 * ISTC Modified (ISTC Modified A3-Main)", whose bracket is the part worth keeping.
 */
function raceNameOf(row: SessionNamingRow, hint: Record<string, unknown>): { name: string; cls: string | null } {
  const parser = row.parserId.toLowerCase();
  if (parser.includes("myrcm")) {
    const name = hintText(hint, "name");
    const cls = hintText(hint, "className");
    if (name) return { name, cls: cls && !name.toLowerCase().includes(cls.toLowerCase()) ? cls : null };
    if (cls) return { name: cls, cls: null };
  }
  const fromPage = parser.includes("liverc") ? hintText(hint, "className") : null;
  if (fromPage && !isOnlyADate(fromPage)) return { name: fromPage, cls: null };

  const label = row.eventDetectionSource === "race" ? usable(row.eventDetectionSessionLabel) : null;
  if (label) {
    const bracket = label.match(/\(([^()]+)\)\s*$/);
    const cleaned = (bracket ? bracket[1]! : label.replace(/^race\s*\d+\s*:\s*/i, "")).trim();
    if (cleaned) return { name: cleaned, cls: null };
  }
  const cls = usable(row.eventRaceClass);
  if (cls) return { name: cls, cls: null };
  return { name: "Race", cls: null };
}

/** Where a session was when no track could be matched: the timing site, said plainly. */
function siteLabel(sourceUrl: string): string {
  const url = sourceUrl.trim();
  if (url.startsWith(MYRCM_PDF_SOURCE_PREFIX)) return "MyRCM";
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (host.includes("speedhive") || host.includes("mylaps")) return "MYLAPS";
    if (host.includes("myrcm")) return "MyRCM";
    return host || "Timing site";
  } catch {
    return "Timing site";
  }
}

function runtimeTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

type Draft = Omit<SessionName, "title" | "autoTitle" | "runNumber" | "isCustom"> & {
  raceName: string | null;
  /** Numbering bucket: whose, where, which day. Null when the driver is unknown. */
  bucket: string | null;
};

function draftName(
  row: SessionNamingRow,
  viewer: { names: Set<string>; chips: Set<string>; displayName: string | null; saved: readonly KnownCompetitor[] },
  opts: { timeZone: string | null; now: Date }
): Draft {
  const drivers = sheetDrivers(row.parsedPayload);
  const hint = sessionHint(row.parsedPayload);
  const driverCount = Math.max(drivers.length, 1);

  const practiceByUrl = importedSessionIsPractice(row.sourceUrl);
  const isRace =
    row.eventDetectionSource === "race"
      ? true
      : row.eventDetectionSource === "practice" || practiceByUrl
        ? false
        : drivers.length > 1;

  // Whose it is.
  const practiceChip = hintText(hint, "practiceTransponder");
  const chip = practiceChip ? normalizeSpeedhiveTransponderNumber(practiceChip) : null;
  const printed = drivers[0]?.name ?? "";
  const siteName = hintText(hint, "practiceSiteName");
  let matchedPrinted: string | null = null;
  let isViewer = false;
  if (isRace) {
    const mine = drivers.find((d) => d.name && viewer.names.has(normalizeName(d.name)));
    if (mine) {
      isViewer = true;
      matchedPrinted = mine.name;
    }
  } else {
    if (row.sweepChipCode?.trim()) isViewer = true;
    if (chip && viewer.chips.has(chip)) isViewer = true;
    if (printed && viewer.names.has(normalizeName(printed))) {
      isViewer = true;
      matchedPrinted = printed;
    }
    if (siteName && viewer.names.has(normalizeName(siteName))) isViewer = true;
  }

  let who: string | null = null;
  if (isViewer) {
    who = personName(viewer.displayName) ?? personName(matchedPrinted) ?? personName(printed) ?? "You";
  } else if (!isRace) {
    // MYLAPS practice names nobody (its "driver" is a time label), so the chip decides there.
    const isMylaps = siteLabel(row.sourceUrl) === "MYLAPS";
    if (chip || isMylaps) {
      const named = practiceColumnName({
        transponder: chip,
        saved: viewer.saved,
        siteName,
        importName: isMylaps ? null : personName(printed),
      });
      who = named === "Imported session" ? null : named;
    } else {
      who = personName(printed);
    }
  }

  // When, on the track's clock.
  const whenIso = resolveImportedSessionDisplayTimeIso({
    sessionCompletedAt: row.sessionCompletedAt ?? null,
    parsedPayload: row.parsedPayload,
    createdAt: row.createdAt,
  });
  const hasWallClock = resolveImportedSessionHasWallClockTime({
    sessionCompletedAt: row.sessionCompletedAt ?? null,
    parsedPayload: row.parsedPayload,
  });
  const timeOpts = {
    timingSource: timingSourceFromParserId(row.parserId) ?? timingSourceFromSourceUrl(row.sourceUrl),
    parserId: row.parserId,
    sourceUrl: row.sourceUrl,
    isWallClockTime: hasWallClock,
    utcOffsetMinutes: sessionUtcOffsetMinutesFromImportedPayload(row.parsedPayload),
    displayTimeZone: opts.timeZone,
  };
  const shown = importedSessionTimeForDisplay(whenIso, timeOpts);
  const zone = shown.timeZone ?? opts.timeZone ?? runtimeTimeZone();
  const dayKey = calendarYmdInTimeZone(shown.iso, zone);
  const dayLabel = formatRunDateWeekday(shown.iso, zone, opts.now);
  // A session with no time of its own is only showing when it was imported: no time on the row.
  const timeLabel = hasWallClock ? formatRunTimeOnly(shown.iso, zone) : null;
  const sortMs = new Date(shown.iso).getTime();

  const place = usable(row.trackName) ?? siteLabel(row.sourceUrl);
  const groupKey = `${dayKey}|${normalizeName(place)}`;

  const race = isRace ? raceNameOf(row, hint) : null;
  const detail = isRace
    ? [race?.cls ?? null, driverCount > 1 ? `${driverCount} drivers` : null].filter(Boolean).join(" · ") || null
    : null;

  // A driver can only be numbered when we know who they are and when they ran.
  const bucket =
    who && hasWallClock ? `${isViewer ? "@viewer" : normalizeName(who)}|${groupKey}` : null;

  return {
    id: row.id,
    isRace,
    who,
    isViewer,
    place,
    dayKey,
    dayLabel,
    timeLabel,
    groupKey,
    groupLabel: `${dayLabel} · ${place}`,
    driverCount,
    detail,
    sortMs,
    raceName: race?.name ?? null,
    bucket,
  };
}

/**
 * Name every session in `rows`. Pass the whole of each day being shown — sessions not on screen,
 * and deleted ones, still hold their place in the day's run numbers.
 */
export function nameImportedSessions(
  rows: readonly SessionNamingRow[],
  viewer: SessionNamingViewer,
  opts?: { timeZone?: string | null; now?: Date }
): Map<string, SessionName> {
  const ctx = {
    names: viewerNameSet(viewer.names),
    chips: chipSet(viewer.transponders),
    displayName: viewer.displayName,
    saved: viewer.saved,
  };
  const o = { timeZone: opts?.timeZone?.trim() || null, now: opts?.now ?? new Date() };

  const drafts = rows.map((row) => ({ row, draft: draftName(row, ctx, o) }));

  // Positions within each (driver, track, day). Races on the viewer's day take a place too — a
  // qualifier between two practice runs is still a time on track — but keep their own name.
  const runNumberById = new Map<string, number>();
  const buckets = new Map<string, Array<(typeof drafts)[number]>>();
  for (const d of drafts) {
    if (!d.draft.bucket) continue;
    if (d.draft.isRace && !d.draft.isViewer) continue;
    const list = buckets.get(d.draft.bucket) ?? [];
    list.push(d);
    buckets.set(d.draft.bucket, list);
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => a.draft.sortMs - b.draft.sortMs || a.row.id.localeCompare(b.row.id));
    let position = 0;
    let lastMs = Number.NEGATIVE_INFINITY;
    for (const d of list) {
      // The same outing on a second timing site shares its number rather than taking the next.
      if (d.draft.sortMs - lastMs > SAME_OUTING_MS) position += 1;
      lastMs = d.draft.sortMs;
      runNumberById.set(d.row.id, position);
    }
  }

  const out = new Map<string, SessionName>();
  for (const { row, draft } of drafts) {
    const runNumber = draft.isRace ? null : (runNumberById.get(row.id) ?? null);
    const label = draft.isRace ? (draft.raceName ?? "Race") : runNumber != null ? `Run ${runNumber}` : "Practice";
    const autoTitle = draft.who ? `${draft.who} · ${label}` : label;
    const custom = row.customName?.trim().slice(0, SESSION_CUSTOM_NAME_MAX) || null;
    out.set(row.id, {
      id: row.id,
      title: custom ?? autoTitle,
      autoTitle,
      isCustom: custom != null,
      isRace: draft.isRace,
      who: draft.who,
      isViewer: draft.isViewer,
      runNumber,
      place: draft.place,
      dayKey: draft.dayKey,
      dayLabel: draft.dayLabel,
      timeLabel: draft.timeLabel,
      groupKey: draft.groupKey,
      groupLabel: draft.groupLabel,
      driverCount: draft.driverCount,
      detail: draft.detail,
      sortMs: draft.sortMs,
    });
  }
  return out;
}

export type SessionGroup<T> = { key: string; label: string; items: T[] };

/**
 * File named sessions under their day-and-track heading.
 *
 * Headings come in the order their first session does, so a list sorted newest-UPLOAD-first keeps
 * that order (a race from March uploaded tonight still leads — founder call, 2026-08-27). Inside a
 * heading the day reads newest first, by the track's clock.
 */
export function groupNamedSessions<T>(items: readonly T[], nameOf: (item: T) => SessionName | undefined): SessionGroup<T>[] {
  const groups: SessionGroup<T>[] = [];
  const byKey = new Map<string, SessionGroup<T>>();
  for (const item of items) {
    const name = nameOf(item);
    const key = name?.groupKey ?? "unnamed";
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: name?.groupLabel ?? "", items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  for (const group of groups) {
    group.items.sort((a, b) => (nameOf(b)?.sortMs ?? 0) - (nameOf(a)?.sortMs ?? 0));
  }
  return groups;
}
