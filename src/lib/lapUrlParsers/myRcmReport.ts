/**
 * MyRCM (myrcm.ch) result reports — reader for the **v9 site** (rebuilt 18.08.2026).
 *
 * MyRCM replaced its whole front end in v9.1.15 and nothing the old reader looked for survived:
 * the address shape moved (`/myrcm/report/<lang>/<e>/<c>` → `/en/report/<e>/<c>`), the session menu
 * stopped being `doAjaxCall(...)` JavaScript and became real buttons, and the results tables were
 * renamed (`#data-table` + a "Laptimes" heading → `table.run-result-table` + `table.run-lap-table`).
 * Old links still 302 to the new ones, but **the redirect drops the query string**, so an old
 * single-session link now lands on the class page — we normalise before fetching, never after.
 *
 * Page shapes, all served as plain public HTML (no account, no key):
 *  - **Event** `/en/report/<eventId>` — renders the *first* class, plus `select#reportClass`
 *    listing every class. So an event URL is a class page that also knows its siblings.
 *  - **Class** `/en/report/<eventId>/<categoryId>` — `button.run-button` per run, nested
 *    `details.phase` (Qualifying/Finals) → `details.group` (Heat 19) → the run ("Qualy 1").
 *    Each button carries an availability icon, so a run that has not happened is knowable.
 *  - **Session** `…?reportKey=<n>&reportType=<t>` — `table.run-result-table` (the classification)
 *    plus one or more `table.run-lap-table` chunks holding the lap matrix.
 *
 * MyRCM's own machine-readable outputs are **broken** since the rebuild and must not be used:
 * `cType=XML` and `cType=JSON` return HTML with a lying Content-Type, and `cType=CSV` returns HTML
 * as UTF-16 Excel.
 *
 * `/rest/v1/report-pdf/...` is the exception, and the line above it used to say it returned a PNG.
 * Rechecked 2026-08-26: it returns a real text-bearing PDF, and it is what MyRCM's own "Download
 * PDF" button on a run report calls. That is now the supported path — read by `myRcmPdf.ts` from a
 * file the **driver** downloaded. The app must never call it: `myrcm.ch` is on the fetch denylist
 * in `http/timingUrlSafetySync.ts`, and this whole module is dormant behind it.
 *
 * This module is pure parsing (no network) so it is unit-testable against saved fixtures.
 */

import { load } from "cheerio";
import type { LapUrlSessionDriver } from "./types";
import { buildMyRcmCategoryUrl, buildMyRcmSessionUrl, type MyRcmReportRef } from "./myRcmUrl";

/** Phase names that hold real result runs, meaningful-first. Unknown phases sort last but are kept. */
const PHASE_ORDER: Record<string, number> = {
  final: 0,
  finals: 1,
  qualifying: 2,
  qualy: 3,
  practice: 4,
  "free practice": 5,
  training: 6,
};

/**
 * URL shapes live in `myRcmUrl.ts` (no cheerio, so the client can use the same rules) and are
 * re-exported here so callers have one import for everything MyRCM.
 */
export {
  buildMyRcmCategoryUrl,
  buildMyRcmEventUrl,
  buildMyRcmSessionUrl,
  classifyMyRcmEventLink,
  isMyRcmCategoryUrl,
  isMyRcmDiscoveryUrl,
  isMyRcmEventUrl,
  isMyRcmHostname,
  isMyRcmReportUrl,
  isMyRcmSessionUrl,
  legacyMyRcmEventIdFromUrl,
  parseMyRcmReportUrl,
} from "./myRcmUrl";
export type { MyRcmReportRef } from "./myRcmUrl";

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

function cleanText(raw: string | null | undefined): string {
  return (raw ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Event / class page — the class list.
// ---------------------------------------------------------------------------

export type MyRcmEventClass = {
  eventId: string;
  categoryId: string;
  className: string;
  categoryUrl: string;
};

/**
 * Every class in the event, from the `select#reportClass` picker that both the event page and each
 * class page render. Replaces the old `openNewWindows(...)` link scrape.
 */
export function parseMyRcmEventClasses(html: string, eventIdHint?: string): MyRcmEventClass[] {
  const $ = load(html);
  const eventId = eventIdHint ?? firstEventIdInHtml($);
  if (!eventId) return [];

  const seen = new Set<string>();
  const out: MyRcmEventClass[] = [];
  $("select#reportClass option").each((_, el) => {
    const categoryId = cleanText($(el).attr("value"));
    const className = cleanText($(el).text());
    if (!/^\d+$/.test(categoryId) || !className || seen.has(categoryId)) return;
    seen.add(categoryId);
    out.push({
      eventId,
      categoryId,
      className,
      categoryUrl: buildMyRcmCategoryUrl(eventId, categoryId),
    });
  });
  return out;
}

/** Any `/report/<eventId>/…` reference on the page — used when the caller has no id to hand. */
function firstEventIdInHtml($: ReturnType<typeof load>): string | null {
  let found: string | null = null;
  $("a[href], button[data-href]").each((_, el) => {
    if (found) return;
    const href = $(el).attr("href") ?? $(el).attr("data-href") ?? "";
    const m = href.match(/\/report\/(\d+)/);
    if (m) found = m[1]!;
  });
  return found;
}

/** The class this page is currently showing (the picker's selected option / header chip). */
export function parseMyRcmSelectedClassName(html: string): string | null {
  const $ = load(html);
  const selected = cleanText($("select#reportClass option[selected]").first().text());
  if (selected) return selected;
  const chip = cleanText($(".event-meta__class").first().text());
  return chip || null;
}

/** Event name / venue / dates from the class or event page header. */
export function parseMyRcmEventHeader(html: string): {
  eventName: string | null;
  venue: string | null;
  dates: string | null;
} {
  const $ = load(html);
  const eventName = cleanText($("h1").first().text()) || null;
  const parts = $(".event-header .event-meta__item, .event-header span")
    .map((_, el) => cleanText($(el).text()))
    .get()
    .filter(Boolean);
  const dates = parts.find((p) => /^\d{2}\.\d{2}(\.\d{4})?([–-]\d{2}\.\d{2}\.\d{4})?$/.test(p)) ?? null;
  const venue = parts.find((p) => p !== eventName && p !== dates && !/^(EVENT|Updated)/i.test(p)) ?? null;
  return { eventName, venue, dates };
}

// ---------------------------------------------------------------------------
// Class page — list the runs.
// ---------------------------------------------------------------------------

export type MyRcmSessionLink = {
  reportKey: string;
  /** Full title, e.g. "Qualifying · Heat 19 · Qualy 1". */
  title: string;
  /** Phase, e.g. "Qualifying" — the old `group` field, kept under its old name for callers. */
  group: string;
  /** Session-only label, e.g. "Heat 19 · Qualy 1". */
  label: string;
  url: string;
  /**
   * MyRCM marks a run green once it has results and red while it is still pending. A pending run
   * imports as an empty session, so the picker can say so instead of failing at import time.
   */
  hasResults: boolean;
};

/** `<summary>Qualifying 5 Groups · 5 Runs AVAILABLE</summary>` → "Qualifying". */
function summaryLabel(raw: string): string {
  let s = cleanText(raw);
  s = s.replace(/\b\d+\s+(Groups?|Runs?)\b/gi, " ");
  s = s.replace(/\b(AVAILABLE|Pending|PENDING|COMPLETE|COMPLETED)\b/g, " ");
  s = s.replace(/[·•|]+/g, " ");
  return cleanText(s);
}

function phaseRank(phase: string): number {
  const key = phase.toLowerCase();
  for (const [name, rank] of Object.entries(PHASE_ORDER)) {
    if (key === name || key.startsWith(name)) return rank;
  }
  return 90;
}

/**
 * List the result runs linked from an event or class page.
 *
 * MyRCM renders the run accordion more than once per page (a compact copy plus one per event day),
 * so dedupe by `reportKey` — without it a two-day meeting lists every run three times.
 */
export function enumerateMyRcmSessions(html: string, ref: MyRcmReportRef): MyRcmSessionLink[] {
  const $ = load(html);
  const seen = new Set<string>();
  const out: MyRcmSessionLink[] = [];

  $("button.run-button, a.run-button").each((_, el) => {
    const btn = $(el);
    const href = btn.attr("data-href") ?? btn.attr("href") ?? "";
    const keyMatch = href.match(/[?&]reportKey=(\d+)/);
    if (!keyMatch) return;
    const reportKey = keyMatch[1]!;
    if (seen.has(reportKey)) return;

    const typeMatch = href.match(/[?&]reportType=([a-z]+)/i);
    const reportType = typeMatch ? typeMatch[1]!.toLowerCase() : null;
    // A class page can link runs belonging to a sibling class; follow the href's own ids.
    const idMatch = href.match(/\/report\/(\d+)(?:\/(\d+))?/);
    const linkRef: MyRcmReportRef = {
      lang: ref.lang,
      eventId: idMatch?.[1] ?? ref.eventId,
      categoryId: idMatch?.[2] ?? ref.categoryId,
      reportKey: null,
      reportType,
    };

    const phase = summaryLabel(btn.closest("details.phase").children("summary").first().text());
    const group = summaryLabel(btn.closest("details.group").children("summary").first().text());
    const run = cleanText(btn.find(".run-button__copy").text()) || cleanText(btn.text());
    const hasResults = btn.find("[class*='run-button__icon--available']").length > 0;

    const labelParts = [group, run].filter(Boolean);
    const titleParts = [phase, group, run].filter(Boolean);

    seen.add(reportKey);
    out.push({
      reportKey,
      title: titleParts.join(" · ") || `Run ${reportKey}`,
      group: phase,
      label: labelParts.join(" · ") || run || `Run ${reportKey}`,
      url: buildMyRcmSessionUrl(linkRef, reportKey, reportType),
      hasResults,
    });
  });

  out.sort((a, b) => {
    const pa = phaseRank(a.group);
    const pb = phaseRank(b.group);
    if (pa !== pb) return pa - pb;
    return Number(a.reportKey) - Number(b.reportKey);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Session page — classification + lap matrix.
// ---------------------------------------------------------------------------

export type MyRcmSessionMeta = {
  /** The run's own name, e.g. "Heat 19". */
  sessionName: string | null;
  /** Not on the v9 session page — carried only when the caller resolves it from the class page. */
  className: string | null;
  eventName: string | null;
  mode: string | null;
  /** Raw MyRCM start time, e.g. "16.08.2026 13:48:42". */
  startTimeRaw: string | null;
  startTimeIso: string | null;
};

export type MyRcmParsedSession = {
  meta: MyRcmSessionMeta;
  drivers: LapUrlSessionDriver[];
  /**
   * True when every driver's lap column length matched the classification's own lap count. The
   * lap matrix is joined by column order, so this is the check that the join did not slip.
   */
  lapCountsAgree: boolean;
};

function normalizeNameKey(raw: string): string {
  return cleanText(raw).toLowerCase();
}

/** Parse a MyRCM lap time token: "20.859" or "1:05.432" → seconds. Ignores empty / 00.000 markers. */
export function parseMyRcmLapTime(raw: string): number | null {
  const t = cleanText(raw).replace(",", ".");
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

/** "16.08.2026 13:48:42" → ISO. Treated as UTC (track-local tz is unknown; used only for recency/order). */
export function parseMyRcmStartTimeToIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = cleanText(raw).match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
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

type ClassificationRow = {
  position: number | null;
  startNumber: string;
  carNumber: string;
  driverName: string;
  normalizedName: string;
  /** The classification's own lap count — used to verify the positional lap-matrix join. */
  statedLapCount: number | null;
  bestTime: number | null;
  note: string;
};

function parseClassification($: ReturnType<typeof load>): ClassificationRow[] {
  const rows: ClassificationRow[] = [];
  $("table.run-result-table tbody tr").each((_, tr) => {
    const cells = new Map<string, string>();
    $(tr)
      .find("td")
      .each((_, td) => {
        const label = cleanText($(td).attr("data-label"));
        if (label) cells.set(label, cleanText($(td).text()));
      });
    const driverName = cells.get("Driver") ?? "";
    if (!driverName) return;
    const posRaw = cells.get("P") ?? "";
    const lapsRaw = cells.get("L") ?? "";
    rows.push({
      position: /^\d+$/.test(posRaw) ? Number.parseInt(posRaw, 10) : null,
      startNumber: cells.get("Start") ?? "",
      carNumber: cells.get("No.") ?? "",
      driverName,
      normalizedName: normalizeNameKey(driverName),
      statedLapCount: /^\d+$/.test(lapsRaw) ? Number.parseInt(lapsRaw, 10) : null,
      bestTime: parseMyRcmLapTime(cells.get("Best") ?? ""),
      note: cells.get("Note") ?? "",
    });
  });
  return rows;
}

type LapColumn = { label: string; laps: number[] };

/**
 * The lap matrix, left to right, across every chunk.
 *
 * MyRCM splits the matrix into `table.run-lap-table` blocks of ten drivers, and the chunks run in
 * classification order — so concatenating their columns reproduces the finishing order exactly.
 * The lap-0 row is MyRCM's staging row (start-line clock, or 00.000 for everyone) and is dropped.
 */
function parseLapColumns($: ReturnType<typeof load>): LapColumn[] {
  const columns: LapColumn[] = [];

  $("table.run-lap-table").each((_, table) => {
    const byLabel = new Map<string, number[]>();
    const order: string[] = [];

    $(table)
      .find("tbody tr")
      .each((_, tr) => {
        const lapNumber = cleanText($(tr).find('td[data-label="Lap"]').first().text());
        $(tr)
          .find("td")
          .each((_, td) => {
            const label = cleanText($(td).attr("data-label"));
            if (!label || label === "Lap") return;
            if (!byLabel.has(label)) {
              byLabel.set(label, []);
              order.push(label);
            }
            if (lapNumber === "0") return; // staging row
            const t = parseMyRcmLapTime($(td).text());
            if (t != null) byLabel.get(label)!.push(t);
          });
      });

    for (const label of order) columns.push({ label, laps: byLabel.get(label) ?? [] });
  });

  return columns;
}

/**
 * Parse a single MyRCM run page (the `?reportKey=<n>` response) into the whole field.
 *
 * The field — not just the driver's own row — is the point: it is what feeds pace-vs-field and the
 * Engineer's rival context, and it is the thing a Speedhive practice activity can never provide.
 */
export function parseMyRcmSessionHtml(html: string): MyRcmParsedSession {
  const $ = load(html);

  const metaSpans = $(".report-meta span")
    .map((_, el) => cleanText($(el).text()))
    .get()
    .filter(Boolean);
  const startTimeRaw = metaSpans.find((s) => /^\d{2}\.\d{2}\.\d{4}(\s|$)/.test(s)) ?? null;
  const meta: MyRcmSessionMeta = {
    sessionName: cleanText($("h1").first().text()) || null,
    className: null,
    eventName: metaSpans[0] ?? null,
    mode: metaSpans.find((s) => s !== metaSpans[0] && s !== startTimeRaw) ?? null,
    startTimeRaw,
    startTimeIso: parseMyRcmStartTimeToIso(startTimeRaw),
  };

  const classification = parseClassification($);
  const columns = parseLapColumns($);

  // Prefer an explicit label match — some events label the lap columns with the driver itself
  // ("Kart 14") rather than an index, and then the join needs no positional trust at all.
  const byLabel = new Map<string, LapColumn>();
  for (const col of columns) {
    const key = normalizeNameKey(col.label);
    if (key && !byLabel.has(key)) byLabel.set(key, col);
  }
  const labelsMatchDrivers =
    classification.length > 0 && classification.every((r) => byLabel.has(r.normalizedName));

  let lapCountsAgree = true;
  const drivers: LapUrlSessionDriver[] = classification.map((row, index) => {
    const col = labelsMatchDrivers ? byLabel.get(row.normalizedName) : columns[index];
    const laps = col?.laps ?? [];
    if (row.statedLapCount != null && row.statedLapCount !== laps.length) lapCountsAgree = false;
    const driverId = row.carNumber || row.startNumber || String(row.position ?? index + 1);
    return {
      id: `myrcm-${index + 1}-${driverId}`,
      driverId,
      driverName: row.driverName,
      normalizedName: row.normalizedName,
      laps,
      lapCount: laps.length,
    };
  });

  if (columns.length > 0 && columns.length !== classification.length) lapCountsAgree = false;

  return { meta, drivers, lapCountsAgree };
}
