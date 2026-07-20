/**
 * MyRCM (myrcm.ch) result reports.
 *
 * A MyRCM "report" URL is `…/myrcm/report/<lang>/<eventId>/<categoryId>` and represents one
 * class (category). The page itself is a JS shell; every session (Free practice / Practice /
 * Qualy / Final run, per heat) loads via `AjaxCall('…?reportKey=<n>', 'Group :: Heat N - Label')`.
 * Fetching that same URL with `?reportKey=<n>` returns a self-contained HTML fragment with a
 * classification table (`#data-table`) + a "Laptimes" matrix (rows = lap #, columns = car #).
 *
 * This module is pure parsing (no network) so it is unit-testable against saved fixtures.
 */

import { load } from "cheerio";
import type { LapUrlSessionDriver } from "./types";

/** Menu groups that contain real result sessions (vs Heat arrangements / Participants / Timeschedule / Rankinglists). */
export const MYRCM_RESULT_GROUPS = ["Free practice", "Practice", "Qualy", "Final"] as const;

/** Meaningful-first ordering for enumerated sessions. */
const GROUP_ORDER: Record<string, number> = {
  Final: 0,
  Qualy: 1,
  Practice: 2,
  "Free practice": 3,
};

export type MyRcmReportRef = {
  lang: string;
  eventId: string;
  categoryId: string;
  /** null for a category (class) URL; set for a single session. */
  reportKey: string | null;
};

function stripHash(s: string): string {
  const h = s.indexOf("#");
  return h >= 0 ? s.slice(0, h) : s;
}

/** Parse `https://www.myrcm.ch/myrcm/report/en/97370/388960[?reportKey=4709]`. */
export function parseMyRcmReportUrl(urlStr: string): MyRcmReportRef | null {
  let u: URL;
  try {
    u = new URL(stripHash(urlStr.trim()));
  } catch {
    return null;
  }
  if (!isMyRcmHost(u.hostname)) return null;
  const m = u.pathname.match(/\/myrcm\/report\/([a-z]{2})\/(\d+)\/(\d+)\/?$/i);
  if (!m) return null;
  const reportKeyRaw = u.searchParams.get("reportKey");
  const reportKey = reportKeyRaw && /^\d+$/.test(reportKeyRaw.trim()) ? reportKeyRaw.trim() : null;
  return { lang: m[1]!.toLowerCase(), eventId: m[2]!, categoryId: m[3]!, reportKey };
}

function isMyRcmHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "myrcm.ch" || h.endsWith(".myrcm.ch");
}

/** Any MyRCM report URL (category or single session). */
export function isMyRcmReportUrl(urlStr: string): boolean {
  return parseMyRcmReportUrl(urlStr) !== null;
}

/** A single-session report URL (has a `reportKey`). */
export function isMyRcmSessionUrl(urlStr: string): boolean {
  const ref = parseMyRcmReportUrl(urlStr);
  return ref !== null && ref.reportKey !== null;
}

/** A category (class) report URL (no `reportKey`). */
export function isMyRcmCategoryUrl(urlStr: string): boolean {
  const ref = parseMyRcmReportUrl(urlStr);
  return ref !== null && ref.reportKey === null;
}

/** The MyRCM event landing page (`/myrcm/main?…dId[E]=<id>`) — a level above a class. */
export function isMyRcmEventUrl(urlStr: string): boolean {
  let u: URL;
  try {
    u = new URL(stripHash(urlStr.trim()));
  } catch {
    return false;
  }
  if (!isMyRcmHost(u.hostname)) return false;
  if (!/\/myrcm\/main\/?$/i.test(u.pathname)) return false;
  return u.searchParams.has("dId[E]");
}

export function buildMyRcmSessionUrl(ref: MyRcmReportRef, reportKey: string): string {
  return `https://www.myrcm.ch/myrcm/report/${ref.lang}/${ref.eventId}/${ref.categoryId}?reportKey=${reportKey}`;
}

export function buildMyRcmCategoryUrl(eventId: string, categoryId: string, lang = "en"): string {
  return `https://www.myrcm.ch/myrcm/report/${lang}/${eventId}/${categoryId}`;
}

/** Event or category URL — a page we can enumerate sessions from (vs a single `reportKey` session). */
export function isMyRcmDiscoveryUrl(urlStr: string): boolean {
  return isMyRcmCategoryUrl(urlStr) || isMyRcmEventUrl(urlStr);
}

// ---------------------------------------------------------------------------
// Event page — list the event's classes (categories).
// ---------------------------------------------------------------------------

export type MyRcmEventClass = {
  eventId: string;
  categoryId: string;
  className: string;
  categoryUrl: string;
};

/** Class links on an event page: `<a … onclick="javascript:openNewWindows(97370, 388960)">E10 TC SPEC</a>` */
const OPEN_REPORT_RE = /openNewWindows\((\d+)\s*,\s*(\d+)\)[^>]*>([^<]*)/g;

/** Parse the classes (categories) listed on a MyRCM event page (`main?…dId[E]=…`). */
export function parseMyRcmEventClasses(eventPageHtml: string): MyRcmEventClass[] {
  const seen = new Set<string>();
  const out: MyRcmEventClass[] = [];
  let m: RegExpExecArray | null;
  OPEN_REPORT_RE.lastIndex = 0;
  while ((m = OPEN_REPORT_RE.exec(eventPageHtml)) !== null) {
    const eventId = m[1]!;
    const categoryId = m[2]!;
    const className = decodeMenuText(m[3] ?? "");
    if (!className || seen.has(categoryId)) continue;
    seen.add(categoryId);
    out.push({
      eventId,
      categoryId,
      className,
      categoryUrl: buildMyRcmCategoryUrl(eventId, categoryId),
    });
  }
  return out;
}

/**
 * Loose class-name match against the app event's configured race class text
 * (either direction contains, case/space-insensitive — "EC10 TC SPEC" ~ "TC Spec").
 */
export function myRcmClassMatchesConfigured(className: string, configured: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\[[^\]]*\]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const a = norm(className);
  const b = norm(configured);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

// ---------------------------------------------------------------------------
// Shell enumeration — list a category's result sessions from its menu.
// ---------------------------------------------------------------------------

export type MyRcmSessionLink = {
  reportKey: string;
  /** Full menu title, e.g. "Qualy :: Heat 2 - Qualy 1". */
  title: string;
  group: string;
  /** Session-only label, e.g. "Heat 2 - Qualy 1". */
  label: string;
  url: string;
};

/** Menu entries look like: doAjaxCall('/myrcm/report/en/97370/388960?reportKey=4709', 'Qualy :: Heat 2 - Qualy 1') */
const AJAX_CALL_RE = /doAjaxCall\('([^']*?reportKey=(\d+))'\s*,\s*'([^']*)'\)/g;

function decodeMenuText(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * List the result sessions (Free practice / Practice / Qualy / Final) linked from a category shell.
 * Deduped by reportKey (the Bootstrap navbar renders the menu twice), ordered meaningful-first.
 */
export function enumerateMyRcmSessions(shellHtml: string, ref: MyRcmReportRef): MyRcmSessionLink[] {
  const seen = new Set<string>();
  const out: MyRcmSessionLink[] = [];

  let m: RegExpExecArray | null;
  AJAX_CALL_RE.lastIndex = 0;
  while ((m = AJAX_CALL_RE.exec(shellHtml)) !== null) {
    const reportKey = m[2]!;
    const title = decodeMenuText(m[3] ?? "");
    if (seen.has(reportKey)) continue;

    const sep = title.indexOf(" :: ");
    const group = sep >= 0 ? title.slice(0, sep).trim() : "";
    if (!MYRCM_RESULT_GROUPS.includes(group as (typeof MYRCM_RESULT_GROUPS)[number])) continue;

    seen.add(reportKey);
    const label = sep >= 0 ? title.slice(sep + 4).trim() : title;
    out.push({ reportKey, title, group, label, url: buildMyRcmSessionUrl(ref, reportKey) });
  }

  out.sort((a, b) => {
    const ga = GROUP_ORDER[a.group] ?? 99;
    const gb = GROUP_ORDER[b.group] ?? 99;
    if (ga !== gb) return ga - gb;
    return Number(a.reportKey) - Number(b.reportKey);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Session fragment parsing — classification + lap-time matrix.
// ---------------------------------------------------------------------------

export type MyRcmSessionMeta = {
  className: string | null;
  raceTime: string | null;
  mode: string | null;
  trackCondition: string | null;
  /** Raw MyRCM start time, e.g. "11.07.2026 15:52:59". */
  startTimeRaw: string | null;
  startTimeIso: string | null;
};

export type MyRcmParsedSession = {
  meta: MyRcmSessionMeta;
  drivers: LapUrlSessionDriver[];
};

function normalizeName(raw: string): string {
  return raw.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

function normalizeNameKey(raw: string): string {
  return normalizeName(raw).toLowerCase();
}

/** Parse a MyRCM lap time token: "20.859" or "1:05.432" → seconds. Ignores empty / 00.000 markers. */
export function parseMyRcmLapTime(raw: string): number | null {
  const t = normalizeName(raw).replace(",", ".");
  if (!t) return null;
  const m = t.match(/^(?:(\d+):)?(\d{1,2}(?:\.\d{1,3})?)$/);
  if (!m) return null;
  const minutes = m[1] ? Number.parseInt(m[1], 10) : 0;
  const seconds = Number.parseFloat(m[2]!);
  if (!Number.isFinite(seconds)) return null;
  const total = minutes * 60 + seconds;
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.round(total * 1000) / 1000;
}

/** "11.07.2026 15:52:59" → ISO. Treated as UTC (track-local tz is unknown; used only for recency/order). */
export function parseMyRcmStartTimeToIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = normalizeName(raw).match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, min, ss] = m;
  const d = Date.UTC(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    hh ? Number(hh) : 0,
    min ? Number(min) : 0,
    ss ? Number(ss) : 0
  );
  if (Number.isNaN(d)) return null;
  return new Date(d).toISOString();
}

function parseHeaderMeta(headerText: string): MyRcmSessionMeta {
  // "Section:  E10 TC SPEC [EC10-SPEC] - Race time:  5:00 - Mode:  Singlestart - Track Condition:  Dry - Starttime:  11.07.2026 15:52:59"
  // The real field separator is " - " (spaces around); hyphens inside a value (e.g. "[EC10-SPEC]") have none.
  const text = normalizeName(headerText);
  const fields = new Map<string, string>();
  for (const seg of text.split(" - ")) {
    const ci = seg.indexOf(":");
    if (ci < 0) continue;
    const label = seg.slice(0, ci).trim();
    const value = seg.slice(ci + 1).trim();
    if (label) fields.set(label, value);
  }
  const orNull = (v: string | undefined): string | null => (v && v.trim() ? v.trim() : null);
  // Drop the trailing "[CODE]" from the class name for display.
  const sectionRaw = orNull(fields.get("Section"));
  const className = sectionRaw ? sectionRaw.replace(/\s*\[[^\]]*\]\s*$/, "").trim() || sectionRaw : null;
  const startTimeRaw = orNull(fields.get("Starttime"));
  return {
    className,
    raceTime: orNull(fields.get("Race time")),
    mode: orNull(fields.get("Mode")),
    trackCondition: orNull(fields.get("Track Condition")),
    startTimeRaw,
    startTimeIso: parseMyRcmStartTimeToIso(startTimeRaw),
  };
}

type ClassificationRow = {
  carNumber: string;
  pilotNr: string;
  driverName: string;
  normalizedName: string;
  lapCount: number | null;
  bestTime: number | null;
  order: number;
};

/**
 * Parse a single MyRCM session fragment (the `?reportKey=<n>` response).
 * Joins the classification (car# → pilot) with the lap-time matrix (car# column → laps).
 */
export function parseMyRcmSessionHtml(html: string): MyRcmParsedSession {
  const $ = load(html);

  const headerText = $("h4#title").first().text();
  const meta = parseHeaderMeta(headerText);

  // --- Classification table (#data-table) ---
  const classTable = $("#data-table").first();
  const headerCells = classTable.find("tr").first().find("th, td");
  const colIndex = (predicate: (label: string) => boolean): number => {
    let idx = -1;
    headerCells.each((i, el) => {
      if (idx >= 0) return;
      if (predicate(normalizeName($(el).text()))) idx = i;
    });
    return idx;
  };
  const carIdx = colIndex((l) => l === "Nr.");
  const pilotNrIdx = colIndex((l) => l === "Pilot Nr");
  const nameIdx = colIndex((l) => l === "Pilot");
  const lapsIdx = colIndex((l) => l === "Laps");
  const bestIdx = colIndex((l) => l === "Besttime");

  const classification: ClassificationRow[] = [];
  let order = 0;
  classTable.find("tr").each((_, tr) => {
    const row = $(tr);
    if (row.find("th").length > 0) return; // header row
    const cells = row.find("td");
    if (cells.length === 0) return;
    const cellText = (i: number): string => (i >= 0 && i < cells.length ? normalizeName(cells.eq(i).text()) : "");
    const carNumber = carIdx >= 0 ? cellText(carIdx) : "";
    const driverName = nameIdx >= 0 ? cellText(nameIdx) : "";
    if (!carNumber && !driverName) return;
    const lapsStr = cellText(lapsIdx);
    const lapCount = /^\d+$/.test(lapsStr) ? Number.parseInt(lapsStr, 10) : null;
    classification.push({
      carNumber,
      pilotNr: cellText(pilotNrIdx),
      driverName,
      normalizedName: normalizeNameKey(driverName),
      lapCount,
      bestTime: parseMyRcmLapTime(cellText(bestIdx)),
      order: order++,
    });
  });

  // --- Lap-time matrix (the table after the "Laptimes" heading) ---
  const lapsByCar = parseLapMatrix($, html);

  const drivers: LapUrlSessionDriver[] = classification.map((row) => {
    const laps = lapsByCar.get(row.carNumber) ?? [];
    const driverId = row.pilotNr || `car-${row.carNumber}`;
    return {
      id: `myrcm-${driverId}-${row.carNumber}`,
      driverId,
      driverName: row.driverName,
      normalizedName: row.normalizedName,
      laps,
      lapCount: laps.length,
    };
  });

  return { meta, drivers };
}

/** Map car number → lap times, from the "Laptimes" matrix. Skips the lap-0 staging row. */
function parseLapMatrix($: ReturnType<typeof load>, html: string): Map<string, number[]> {
  const result = new Map<string, number[]>();

  // The laptime table is the one whose header first cell is "#Nr.".
  let lapTable: ReturnType<typeof $> | null = null;
  $("table").each((_, table) => {
    if (lapTable) return;
    const firstHeader = normalizeName($(table).find("tr").first().find("th, td").first().text());
    if (firstHeader === "#Nr.") lapTable = $(table);
  });
  if (!lapTable) return result;

  // Header: index → car number (cells like "# 4"); skip "#Nr." and the trailing empty column.
  const colToCar = new Map<number, string>();
  (lapTable as ReturnType<typeof $>)
    .find("tr")
    .first()
    .find("th, td")
    .each((i, el) => {
      const t = normalizeName($(el).text());
      const m = t.match(/^#\s*(\d+)$/);
      if (m) {
        colToCar.set(i, m[1]!);
        result.set(m[1]!, []);
      }
    });

  (lapTable as ReturnType<typeof $>).find("tr").each((ri, tr) => {
    if (ri === 0) return; // header
    const cells = $(tr).find("td");
    if (cells.length === 0) return;
    const lapNumStr = normalizeName(cells.eq(0).text());
    if (lapNumStr === "0") return; // staging row (00.000 for everyone)
    colToCar.forEach((car, colIdx) => {
      const cellText = normalizeName(cells.eq(colIdx).text());
      const t = parseMyRcmLapTime(cellText);
      if (t != null) result.get(car)!.push(t);
    });
  });

  return result;
}
