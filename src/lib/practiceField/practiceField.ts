import type { KnownCompetitor } from "@/lib/speedhive/knownCompetitors";
import { normalizeSpeedhiveTransponderNumber } from "@/lib/speedhive/speedhiveTransponder";

/**
 * Everyone who practised at a track — the list behind "Someone else's practice" and the lap
 * sheet's Practice tab.
 *
 * Two timing sites, two shapes, never merged (founder call 2026-09-21): a track on both gets a
 * switch and shows one site's list at a time, because the same driver is named differently on
 * each and a merged list would print them twice.
 *
 *   LiveRC  one DAY at a time. The day's practice page prints name, class, chip, laps and fast lap
 *           for every session, so one request answers everything.
 *   MYLAPS  the most recent activity, across days. A row is a chip and whatever its owner typed
 *           against it in their own MYLAPS account — a name, a nickname, or nothing. Laps cost a
 *           request per visit, so they are fetched when a driver is opened, not before.
 *
 * ON DEMAND ONLY, like the chip pull it grew out of: nothing here runs on a timer.
 *
 * Pure on purpose — the grouping and the search are tested without a database or a network.
 */

export type PracticeFieldSource = "liverc" | "mylaps";

export const PRACTICE_FIELD_SOURCE_LABEL: Record<PracticeFieldSource, string> = {
  liverc: "LiveRC",
  mylaps: "MYLAPS",
};

export type PracticeFieldSession = {
  /** Importable as-is: the same URL a driver would paste. */
  sessionUrl: string;
  sessionCompletedAtIso: string | null;
  lapCount: number | null;
  bestLapSeconds: number | null;
  /** Already in the asker's library, so it opens without touching the timing site again. */
  importedSessionId: string | null;
};

export type PracticeFieldDriver = {
  /** Stable within one list: the chip when the site prints one, the name when it doesn't. */
  key: string;
  /** What the timing site calls them. Null when it says nothing — an unlabelled MYLAPS chip. */
  siteName: string | null;
  /** Digits only, normalised the same way a saved competitor's is, so the two compare equal. */
  transponder: string | null;
  className: string | null;
  /** LiveRC: every session that day, newest first. MYLAPS: null until the driver is opened. */
  sessions: PracticeFieldSession[] | null;
  /** Sessions on LiveRC; visits in the recent list on MYLAPS. */
  sessionCount: number;
  latestIso: string | null;
  bestLapSeconds: number | null;
  /** The asker's own row — their chip, or their name on this site. Set by the loader. */
  isViewer: boolean;
};

function isoMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The subset of a parsed LiveRC practice row this needs — see `extractPracticeSessions`. */
export type LiveRcPracticeRowInput = {
  driverName: string;
  listLinkText: string | null;
  sessionUrl: string;
  sessionCompletedAtIso: string | null;
  className: string | null;
  transponder: number | null;
  lapCount: number | null;
  fastLapSeconds: number | null;
};

/**
 * One row per driver, their sessions under them.
 *
 * Keyed on chip AND name: a club's loaner chip is worn by several people in a day, and one row
 * called "Sam" holding Alex's laps is worse than two rows. A driver with two cars has two chips
 * and gets two rows, which is right — each is a different car.
 */
export function groupLiveRcPracticeRows(rows: readonly LiveRcPracticeRowInput[]): PracticeFieldDriver[] {
  const byKey = new Map<string, PracticeFieldDriver>();
  for (const r of rows) {
    const siteName = r.listLinkText?.trim() || r.driverName.trim() || null;
    const transponder =
      r.transponder != null ? normalizeSpeedhiveTransponderNumber(String(r.transponder)) : null;
    const key = `${transponder ? `chip:${transponder}` : "nochip"}|${nameKey(siteName ?? "")}`;
    let driver = byKey.get(key);
    if (!driver) {
      driver = {
        key,
        siteName,
        transponder: transponder || null,
        className: null,
        sessions: [],
        sessionCount: 0,
        latestIso: null,
        bestLapSeconds: null,
        isViewer: false,
      };
      byKey.set(key, driver);
    }
    driver.sessions!.push({
      sessionUrl: r.sessionUrl,
      sessionCompletedAtIso: r.sessionCompletedAtIso,
      lapCount: r.lapCount,
      bestLapSeconds: r.fastLapSeconds,
      importedSessionId: null,
    });
    const cls = r.className?.trim();
    if (cls && !(driver.className ?? "").split(" / ").includes(cls)) {
      driver.className = driver.className ? `${driver.className} / ${cls}` : cls;
    }
  }
  for (const d of byKey.values()) {
    d.sessions!.sort((a, b) => isoMs(b.sessionCompletedAtIso) - isoMs(a.sessionCompletedAtIso));
    d.sessionCount = d.sessions!.length;
    d.latestIso = d.sessions![0]?.sessionCompletedAtIso ?? null;
    for (const s of d.sessions!) {
      if (s.bestLapSeconds != null && (d.bestLapSeconds == null || s.bestLapSeconds < d.bestLapSeconds)) {
        d.bestLapSeconds = s.bestLapSeconds;
      }
    }
  }
  return [...byKey.values()];
}

/** The subset of a MYLAPS practice activity this needs — see `speedhivePracticeClient`. */
export type MylapsActivityInput = {
  startTime?: string;
  endTime?: string;
  chipLabel?: string;
  chipCode?: string;
};

/**
 * One row per chip. The label is the owner's own, and often isn't a name: MYLAPS fills an
 * unnamed chip's label with the chip number, which is not a name and is dropped here so the
 * row reads "Transponder 2450937" rather than a number pretending to be a person.
 */
export function groupMylapsActivities(activities: readonly MylapsActivityInput[]): PracticeFieldDriver[] {
  const byChip = new Map<string, PracticeFieldDriver>();
  for (const a of activities) {
    const transponder = normalizeSpeedhiveTransponderNumber(a.chipCode ?? "");
    if (!transponder) continue;
    const label = a.chipLabel?.trim() ?? "";
    const labelIsJustTheNumber =
      !/[a-z]/i.test(label) && normalizeSpeedhiveTransponderNumber(label) === transponder;
    const siteName = label && !labelIsJustTheNumber ? label : null;
    const whenIso = a.endTime?.trim() || a.startTime?.trim() || null;
    const when = whenIso && isoMs(whenIso) > 0 ? new Date(isoMs(whenIso)).toISOString() : null;

    const driver = byChip.get(transponder);
    if (!driver) {
      byChip.set(transponder, {
        key: `chip:${transponder}`,
        siteName,
        transponder,
        className: null,
        sessions: null,
        sessionCount: 1,
        latestIso: when,
        bestLapSeconds: null,
        isViewer: false,
      });
      continue;
    }
    driver.sessionCount++;
    if (!driver.siteName && siteName) driver.siteName = siteName;
    if (isoMs(when) > isoMs(driver.latestIso)) driver.latestIso = when;
  }
  return [...byChip.values()];
}

function savedFor(driver: PracticeFieldDriver, saved: readonly KnownCompetitor[]): KnownCompetitor | null {
  if (!driver.transponder) return null;
  return saved.find((s) => s.transponder === driver.transponder) ?? null;
}

export function practiceDriverIsSaved(
  driver: PracticeFieldDriver,
  saved: readonly KnownCompetitor[]
): boolean {
  return savedFor(driver, saved) != null;
}

/** Your name for them wins; then the timing site's; then the bare number. */
export function practiceDriverDisplayName(
  driver: PracticeFieldDriver,
  saved: readonly KnownCompetitor[]
): string {
  return (
    savedFor(driver, saved)?.name ||
    driver.siteName ||
    (driver.transponder ? `Transponder ${driver.transponder}` : "Unknown driver")
  );
}

/** A query that can only be a transponder: digits, long enough to be one. */
export function practiceQueryAsTransponder(query: string): string | null {
  const q = query.trim();
  if (!/^\d{4,10}$/.test(q)) return null;
  return normalizeSpeedhiveTransponderNumber(q) || null;
}

/**
 * What the list shows for a search, in the order it shows it.
 *
 * `onlyTransponder` is a saved driver's button held down: it beats the text box, because the
 * chip is exact and a name is not. Text matches your name for them, the site's name for them,
 * or any run of digits in their number. Saved drivers lead; after that the quickest lap leads
 * where the list carries lap times (LiveRC) and the most recent visit where it doesn't (MYLAPS).
 */
export function filterPracticeField(
  drivers: readonly PracticeFieldDriver[],
  opts: { query: string; onlyTransponder: string | null; saved: readonly KnownCompetitor[] }
): PracticeFieldDriver[] {
  const q = opts.query.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  const kept = drivers.filter((d) => {
    if (opts.onlyTransponder) return d.transponder === opts.onlyTransponder;
    if (!q) return true;
    if (practiceDriverDisplayName(d, opts.saved).toLowerCase().includes(q)) return true;
    if (d.siteName?.toLowerCase().includes(q)) return true;
    return digits.length > 0 && digits === q && (d.transponder ?? "").includes(digits);
  });
  return kept.sort((a, b) => {
    const savedDelta =
      (practiceDriverIsSaved(a, opts.saved) ? 0 : 1) - (practiceDriverIsSaved(b, opts.saved) ? 0 : 1);
    if (savedDelta !== 0) return savedDelta;
    if (a.bestLapSeconds != null || b.bestLapSeconds != null) {
      if (a.bestLapSeconds == null) return 1;
      if (b.bestLapSeconds == null) return -1;
      if (a.bestLapSeconds !== b.bestLapSeconds) return a.bestLapSeconds - b.bestLapSeconds;
    }
    return isoMs(b.latestIso) - isoMs(a.latestIso);
  });
}

/** Practice or race? Read off the URL the session was imported from. */
export function importedSessionIsPractice(sourceUrl: string | null | undefined): boolean {
  const url = sourceUrl?.trim().toLowerCase() ?? "";
  if (!url) return false;
  if (url.includes("liverc.com") && url.includes("p=view_session")) return true;
  if (url.includes("speedhive") && /\/practice\/\d+\/activities\//.test(url)) return true;
  return false;
}

/**
 * What heads a brought-in driver's column on the lap sheet.
 *
 * The import's own driver name is last, not first: on MYLAPS it is a label the chip's owner
 * typed (or, for a practice loop, a time — MYLAPS names nobody), and a column headed by a word
 * you didn't choose is a column you have to decode. So: your saved name for that chip, then what
 * the practice list called them when they were ticked, then the site's name, then the number.
 */
export function practiceColumnName(input: {
  transponder: string | null | undefined;
  saved: readonly KnownCompetitor[];
  /** What the Practice list showed when this driver was ticked, this visit. */
  visitName?: string | null;
  /** The timing site's own name for them, kept with the import. */
  siteName?: string | null;
  /** The driver name the import parsed — the old heading. */
  importName?: string | null;
}): string {
  const chip = input.transponder ? normalizeSpeedhiveTransponderNumber(input.transponder) : null;
  const savedName = chip ? input.saved.find((s) => s.transponder === chip)?.name : null;
  return (
    savedName?.trim() ||
    input.visitName?.trim() ||
    input.siteName?.trim() ||
    (chip ? `Transponder ${chip}` : "") ||
    input.importName?.trim() ||
    "Imported session"
  );
}

/**
 * The surname that goes over one of a driver's own run columns once the sheet holds more than
 * one driver — "Caruso" above "Run 5", beside "David CALWELL". Null for the placeholders a run
 * wears when nobody's name is known, which would print "Me" as if it were a surname.
 */
/** The driver of a run, in full, for where there is room — null for the same placeholders. */
export function runOwnerName(driverLabel: string | null | undefined): string | null {
  const label = driverLabel?.trim().replace(/\s+/g, " ") ?? "";
  return !label || /^(me|driver)$/i.test(label) ? null : label;
}

export function runOwnerSurname(driverLabel: string | null | undefined): string | null {
  const label = driverLabel?.trim() ?? "";
  if (!label || /^(me|driver)$/i.test(label)) return null;
  const parts = label.split(/\s+/);
  const last = parts[parts.length - 1]!;
  // Timing sites shout; a saved name doesn't. One case for both.
  return last.charAt(0).toUpperCase() + last.slice(1).toLowerCase();
}
