/**
 * MyRCM run-result **PDF** reader — the replacement for the page reader that was switched off.
 *
 * `myrcm.ch` is on the fetch denylist (`http/timingUrlSafetySync.ts`): the app never requests
 * anything from MyRCM. This module reads a file the *driver* downloaded with MyRCM's own
 * "Download PDF" button on their run-result page, so the only party that ever talks to MyRCM is
 * a person clicking a control MyRCM built for them. Nothing here fetches, and nothing here may
 * ever be given a URL.
 *
 * The file is a real text PDF (`%PDF-1.4`, ~960 KB for an 8-driver 78-lap final), not a raster —
 * so there is no OCR anywhere in this path and the numbers come out exactly as MyRCM printed
 * them. Measured on the LS Club Day A-Final (event 96077, 23.08.2026): 19,167 characters of
 * extractable text across 8 pages.
 *
 * ## What the layout actually is, and the six ways it bites
 *
 * The lap matrix has **no driver names in it**. Its only header is the word `LAP`. Every cell
 * reads like `(2) 24.321` — or like `16.505`, because there are **two printed formats** and which
 * one you get is a property of the event. See `BARE_LAP_CELL_RE`; supporting only the bracketed
 * form silently kills the feature for most of European racing.
 *
 *  1. **The bracket is not the driver.** It is that driver's running position *after that lap*, so
 *     it changes down a column. Keying on it scrambles every driver's laps into plausible-looking
 *     nonsense. The **column** is the driver: columns run left to right in classification order.
 *     Verified on the A-Final — column 8 carries 21.810 on lap 9, which is exactly P8 Brad Smith's
 *     stated best lap.
 *
 *  2. **Every lap is printed twice.** Once under "Lap list" and again as an appendix after the
 *     analysis charts, re-rendered at different x positions. 1,136 cells where there are 568 real
 *     laps. The second block is detected by lap numbering restarting once every driver already has
 *     a column, and dropped.
 *
 *  3. **Columns disappear as drivers finish.** A driver who completed fewer laps sits lower in the
 *     classification (it sorts on lap count first), so columns always vanish from the *right* and
 *     never from the middle. That is what makes left-to-right index assignment safe.
 *
 *  4. **The opening part-lap moves around.** Some events number it lap 0 and leave it out of `L`
 *     (TITC); some number it lap 1 and count it (EFRA); some have none at all. It is always in
 *     `TOTAL`. See `LapBlock` and the best-lap check.
 *
 *  5. **The page footer sits between lap rows**, because the matrix spans pages. Treating the first
 *     non-lap band as the end of the table cost the qualy fixture 13 of its 25 laps.
 *
 *  6. **The analysis pages carry per-lap figures** — consistency, gap to leader — that are
 *     indistinguishable from lap times once the `(n)` bracket is gone. Reading them turned an
 *     8-column final into 12. Hence the `LAP`-header gate.
 *
 * A last trap is in the classification table rather than the lap matrix: one driver occupies up
 * to three visual lines (name, then the numeric row, then the club) and the numeric row is *not*
 * reliably the first of them. Bands are cut on the position cells in the `P` column instead.
 *
 * ## The self-check
 *
 * The file carries its own answer key. **The sum is the check that matters**: every driver's laps
 * (plus their start segment) add up to their printed `TOTAL` to the millisecond — 30 of 30 drivers
 * across four real documents. It fails the moment a lap lands in the wrong column, because a swap
 * moves time between two drivers. Lap count is *not* trustworthy — it disagrees legitimately when
 * the loop misses a crossing — so it warns and never blocks.
 *
 * A report that does not reconcile is returned with `reconciled: false` and must not be saved: a
 * wrong lap time is worse than a missing one, because the Engineer will give advice on it.
 *
 * Pure parsing, no network and no native dependency: it takes rows already extracted by
 * `myRcmPdfText.ts` (which owns the pdfjs call) so it is unit-testable and cheap.
 */

import type { LapUrlParseResult, LapUrlSessionDriver } from "./types";
import { MYRCM_PDF_PARSER_ID } from "./myRcmPdfSource";

/** One positioned run of text from the PDF. `y` rises up the page, as in PDF user space. */
export type MyRcmPdfCell = { x: number; y: number; text: string };

/** Cells sharing one visual line, ordered left to right. */
export type MyRcmPdfBand = { page: number; y: number; cells: MyRcmPdfCell[] };

export type MyRcmPdfDriver = {
  /** Finishing position as printed in the `P` column. */
  position: number;
  carNumber: string | null;
  driverName: string;
  /** Club/team printed under the name. Informational — never used to match a driver. */
  club: string | null;
  /** Lap count as printed in the `L` column — one half of the answer key. */
  statedLapCount: number;
  /** `TOTAL`, left as printed (e.g. "30:07.747"). */
  statedTotalTime: string | null;
  /** `TOTAL` in seconds — the strongest half of the answer key. */
  statedTotalSeconds: number | null;
  /** `BEST` in seconds. */
  statedBestLapSeconds: number | null;
  /** `NOTE`, e.g. "DNS". */
  note: string | null;
  /** Laps read out of the matrix, in order. The start segment is NOT one of them. */
  laps: number[];
  /**
   * Lap 0 — start signal to first crossing — in seconds, when the event prints one and it is not
   * zero. Counted in `TOTAL` by MyRCM but never in `L`, so it is kept out of `laps` and added back
   * only for the reconcile.
   */
  startSegmentSeconds: number | null;
  /**
   * Whole seconds MyRCM added to `TOTAL` over and above the laps — a time penalty. Read off the
   * arithmetic, not off the page: the file prints the penalised total and says nothing else. Null
   * when the laps account for the total on their own.
   */
  penaltySeconds: number | null;
};

export type MyRcmPdfIssue = {
  position: number;
  driverName: string;
  kind: "total_time" | "best_lap" | "no_laps" | "lap_count" | "penalty";
  /**
   * `error` blocks the import; `warning` does not.
   *
   * Only `lap_count` is a warning, and it is one on evidence: in the qualy fixture P1's laps sum to
   * his printed total *to the millisecond* while his stated lap count is two higher. That is a
   * missed transponder crossing — two laps recorded as one long one — not a parse fault. Refusing
   * the import over it would reject good data from a real, ordinary session.
   */
  severity: "error" | "warning";
  detail: string;
};

export type MyRcmPdfReport = {
  /** e.g. "Finals A". */
  sessionName: string | null;
  /** e.g. "LS Club Day". */
  eventName: string | null;
  /** e.g. "1/5th Scale". */
  className: string | null;
  /** Printed run time, treated as UTC — the track's timezone is not in the file. */
  sessionCompletedAtIso: string | null;
  drivers: MyRcmPdfDriver[];
  /** True when no driver raised an `error` issue. Warnings do not clear it. */
  reconciled: boolean;
  issues: MyRcmPdfIssue[];
};

export class MyRcmPdfParseError extends Error {
  readonly code:
    | "not_a_run_result"
    | "no_classification"
    | "no_lap_matrix";

  constructor(code: MyRcmPdfParseError["code"], message: string) {
    super(message);
    this.name = "MyRcmPdfParseError";
    this.code = code;
  }
}

/**
 * Two text runs are on the same visual line within this many points.
 *
 * Sized from the file, not guessed: a lap row's number sits 0.7pt off its cells, while consecutive
 * lap rows are ~31pt apart and classification rows ~36-47pt apart. Anything from ~2 to ~25 works;
 * 4 is comfortably inside the gap at both ends.
 */
const BAND_TOLERANCE_PT = 4;

/** A cell belongs to a column when it starts at or after the anchor, allowing for kerning drift. */
const COLUMN_SNAP_PT = 6;

/** `(3) 24.321` — bracket is the running position after the lap, NOT the driver. */
const LAP_CELL_RE = /^\((\d+)\)\s*([0-9:.,]+)\s*\*?$/;

/**
 * The other lap cell shape: a bare time, no bracket.
 *
 * MyRCM prints the lap matrix two different ways and which one you get is a property of the event,
 * not the report. The club meeting used `(2) 24.321`; the EFRA European Championship
 * (`98914/393527`, E10 TC SPEC) prints `16.505`. A reader that only knows the bracketed form
 * reports "this file has no lap times in it" for the entire second class of events — which is most
 * of European racing.
 */
const BARE_LAP_CELL_RE = /^(?:(\d+):)?(\d{1,2}[.,]\d{1,3})\s*\*?$/;

/** A lap time cell in either printed form; null when the text is not one. */
function lapCellSeconds(text: string): number | null {
  const bracketed = text.match(LAP_CELL_RE);
  if (bracketed) return parseMyRcmPdfTime(bracketed[2] as string);
  if (BARE_LAP_CELL_RE.test(text)) return parseMyRcmPdfTime(text);
  return null;
}

/** The lap matrix's only header. Used as the gate on reading bare numbers as lap times. */
const isLapTableHeader = (band: MyRcmPdfBand): boolean =>
  band.cells.length === 1 && (band.cells[0] as MyRcmPdfCell).text.toUpperCase() === "LAP";

/** "23.08.2026 14:49:21" */
const PRINTED_DATETIME_RE = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * "22.013" / "1:02.345" → seconds.
 *
 * Mirrors `parseMyRcmLapTime` in the (dormant) HTML reader deliberately rather than importing it:
 * that module pulls in cheerio and is meant to be unreachable, and ten pure lines are a smaller
 * price than a live dependency on dead code.
 */
export function parseMyRcmPdfTime(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (!t) return null;
  const m = t.match(/^(?:(\d+):)?(\d{1,2}(?:\.\d{1,3})?)$/);
  if (!m) return null;
  const minutes = m[1] ? Number.parseInt(m[1], 10) : 0;
  const seconds = Number.parseFloat(m[2] as string);
  if (!Number.isFinite(seconds)) return null;
  const total = minutes * 60 + seconds;
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.round(total * 1000) / 1000;
}

/** Printed local time → ISO, treated as UTC. The file does not carry the track's timezone. */
export function parseMyRcmPdfDateTime(raw: string): string | null {
  const m = raw.trim().match(PRINTED_DATETIME_RE);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, min, ss] = m;
  const ms = Date.UTC(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    hh ? Number(hh) : 0,
    min ? Number(min) : 0,
    ss ? Number(ss) : 0
  );
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

/** Group positioned cells into visual lines, page by page, top of the page first. */
export function bandCells(cells: Array<MyRcmPdfCell & { page: number }>): MyRcmPdfBand[] {
  const sorted = [...cells].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const bands: MyRcmPdfBand[] = [];

  for (const cell of sorted) {
    const open = bands[bands.length - 1];
    if (open && open.page === cell.page && Math.abs(open.y - cell.y) <= BAND_TOLERANCE_PT) {
      open.cells.push({ x: cell.x, y: cell.y, text: cell.text });
      continue;
    }
    bands.push({ page: cell.page, y: cell.y, cells: [{ x: cell.x, y: cell.y, text: cell.text }] });
  }

  for (const band of bands) band.cells.sort((a, b) => a.x - b.x);
  return bands;
}

const bandText = (band: MyRcmPdfBand): string => band.cells.map((c) => c.text).join(" ");

/** Columns are keyed off the printed header row, never off hard-coded x positions. */
type ClassificationAnchors = {
  bandIndex: number;
  position: number;
  carNumber: number | null;
  driver: number;
  lapCount: number | null;
  total: number | null;
  best: number | null;
  note: number | null;
};

function findClassificationAnchors(bands: MyRcmPdfBand[]): ClassificationAnchors | null {
  for (let i = 0; i < bands.length; i += 1) {
    const band = bands[i] as MyRcmPdfBand;
    const byText = new Map<string, number>();
    for (const cell of band.cells) byText.set(cell.text.toUpperCase(), cell.x);

    const position = byText.get("P");
    const driver = byText.get("DRIVER");
    if (position === undefined || driver === undefined) continue;

    return {
      bandIndex: i,
      position,
      carNumber: byText.get("#") ?? null,
      driver,
      lapCount: byText.get("L") ?? null,
      total: byText.get("TOTAL") ?? null,
      best: byText.get("BEST") ?? null,
      note: byText.get("NOTE") ?? null,
    };
  }
  return null;
}

/** The column an x belongs to: the nearest anchor at or before it. */
function columnFor(x: number, anchors: Array<{ key: string; x: number }>): string | null {
  let best: { key: string; x: number } | null = null;
  for (const anchor of anchors) {
    if (x + COLUMN_SNAP_PT < anchor.x) continue;
    if (!best || anchor.x > best.x) best = anchor;
  }
  return best ? best.key : null;
}

type ParsedClassification = {
  drivers: Array<Omit<MyRcmPdfDriver, "laps" | "startSegmentSeconds">>;
  /** Index of the band the table ends on, so lap scanning can start after it. */
  endBandIndex: number;
};

function parseClassification(bands: MyRcmPdfBand[]): ParsedClassification {
  const anchors = findClassificationAnchors(bands);
  if (!anchors) {
    throw new MyRcmPdfParseError(
      "no_classification",
      "No results table found. This looks like a summary report rather than a single run — open the run itself on MyRCM and download that."
    );
  }

  const columns: Array<{ key: string; x: number }> = [
    { key: "position", x: anchors.position },
    { key: "driver", x: anchors.driver },
  ];
  if (anchors.carNumber !== null) columns.push({ key: "carNumber", x: anchors.carNumber });
  if (anchors.lapCount !== null) columns.push({ key: "lapCount", x: anchors.lapCount });
  if (anchors.total !== null) columns.push({ key: "total", x: anchors.total });
  if (anchors.best !== null) columns.push({ key: "best", x: anchors.best });
  if (anchors.note !== null) columns.push({ key: "note", x: anchors.note });

  // The table runs from the header to wherever the lap matrix begins.
  let endBandIndex = bands.length;
  for (let i = anchors.bandIndex + 1; i < bands.length; i += 1) {
    const band = bands[i] as MyRcmPdfBand;
    // Bracketed cells only: a *bare* time would also match the classification's own BEST column
    // and cut the results table off at its first driver.
    const hasLapCells = band.cells.some((c) => LAP_CELL_RE.test(c.text));
    if (isLapTableHeader(band) || hasLapCells) {
      endBandIndex = i;
      break;
    }
  }

  // Cut a band per driver on the position cells — the numeric row is not reliably the topmost
  // line of a driver's record, so the P column is the only stable spine.
  const spine: Array<{ bandIndex: number; y: number; position: number }> = [];
  for (let i = anchors.bandIndex + 1; i < endBandIndex; i += 1) {
    const band = bands[i] as MyRcmPdfBand;
    for (const cell of band.cells) {
      if (Math.abs(cell.x - anchors.position) > COLUMN_SNAP_PT * 2) continue;
      if (!/^\d{1,3}$/.test(cell.text)) continue;
      spine.push({ bandIndex: i, y: cell.y, position: Number.parseInt(cell.text, 10) });
      break;
    }
  }

  if (!spine.length) {
    throw new MyRcmPdfParseError("no_classification", "The results table has no finishing positions in it.");
  }

  const drivers: Array<Omit<MyRcmPdfDriver, "laps" | "startSegmentSeconds">> = [];

  for (let k = 0; k < spine.length; k += 1) {
    const here = spine[k] as (typeof spine)[number];
    const prev = k > 0 ? (spine[k - 1] as (typeof spine)[number]) : null;
    const next = k + 1 < spine.length ? (spine[k + 1] as (typeof spine)[number]) : null;

    const ceiling = prev ? (prev.y + here.y) / 2 : Number.POSITIVE_INFINITY;
    const floor = next ? (here.y + next.y) / 2 : Number.NEGATIVE_INFINITY;

    const owned: MyRcmPdfCell[] = [];
    for (let i = anchors.bandIndex + 1; i < endBandIndex; i += 1) {
      for (const cell of (bands[i] as MyRcmPdfBand).cells) {
        if (cell.y < ceiling && cell.y > floor) owned.push(cell);
      }
    }

    const byColumn = new Map<string, MyRcmPdfCell[]>();
    for (const cell of owned) {
      const key = columnFor(cell.x, columns);
      if (!key) continue;
      const list = byColumn.get(key);
      if (list) list.push(cell);
      else byColumn.set(key, [cell]);
    }

    // Name is the driver column's topmost line; anything below it is the club.
    const nameCells = [...(byColumn.get("driver") ?? [])].sort((a, b) => b.y - a.y || a.x - b.x);
    const topY = nameCells.length ? (nameCells[0] as MyRcmPdfCell).y : 0;
    const driverName = nameCells
      .filter((c) => Math.abs(c.y - topY) <= BAND_TOLERANCE_PT)
      .map((c) => c.text)
      .join(" ")
      .trim();
    const club =
      nameCells
        .filter((c) => Math.abs(c.y - topY) > BAND_TOLERANCE_PT)
        .map((c) => c.text)
        .join(" ")
        .trim() || null;

    const first = (key: string): string | null => {
      const list = byColumn.get(key);
      if (!list || !list.length) return null;
      const sorted = [...list].sort((a, b) => b.y - a.y || a.x - b.x);
      return (sorted[0] as MyRcmPdfCell).text;
    };

    const lapCountText = first("lapCount");
    const bestText = first("best");
    const totalText = first("total");
    const noteText = first("note");

    drivers.push({
      position: here.position,
      carNumber: first("carNumber"),
      driverName: driverName || `P${here.position}`,
      club,
      statedLapCount: lapCountText && /^\d+$/.test(lapCountText) ? Number.parseInt(lapCountText, 10) : 0,
      statedTotalTime: totalText,
      statedTotalSeconds: totalText ? parseMyRcmPdfTime(totalText) : null,
      statedBestLapSeconds: bestText ? parseMyRcmPdfTime(bestText) : null,
      note: noteText && noteText !== "-" ? noteText : null,
      penaltySeconds: null,
    });
  }

  drivers.sort((a, b) => a.position - b.position);
  return { drivers, endBandIndex };
}

type LapRow = { lapNumber: number | null; times: Array<{ x: number; seconds: number }> };

/**
 * One printing of the lap matrix: the lap rows, plus the **lap 0** row if the event has one.
 *
 * Lap 0 is the start segment — from the start signal to the driver's first crossing. Whether it
 * exists, and whether it carries a real time, varies by event:
 *
 *  - TITC Thailand: present, real (9.431s for the winner), **counted in `TOTAL` but not in `L`**.
 *  - LS Club Day qualy: present, all zeros — decorative.
 *  - LS Club Day final / EFRA EC: absent; EFRA's *lap 1* is the part-lap instead and IS counted.
 *
 * It is kept apart from `rows` because it is not a lap and must never reach the driver's lap list,
 * but it has to be added back when checking the sum against `TOTAL` — without it, every driver in a
 * standing-start race looks ten seconds short.
 */
type LapBlock = { rows: LapRow[]; startRow: LapRow | null };

/**
 * Lap rows in document order, split into blocks wherever the lap numbering restarts.
 *
 * A restart means one of two things and the caller decides which: the next chunk of drivers (MyRCM
 * splits wide fields into blocks of ten columns), or the appendix re-print of the same laps.
 *
 * **Only rows under a `LAP` header are read.** That gate is what makes it safe to accept a bare
 * `20.311` as a lap time: the analysis pages further down carry per-lap gap and consistency figures
 * that look identical to a lap time out of context, and without the header check they would be
 * collected as extra laps for whichever driver's column they happened to line up with.
 */
function parseLapBlocks(bands: MyRcmPdfBand[], fromBandIndex: number): LapBlock[] {
  const blocks: LapBlock[] = [];
  let current: LapRow[] = [];
  let currentStart: LapRow | null = null;
  let lastLapNumber = 0;
  let inLapTable = false;

  /**
   * The topmost and bottommost line of each page is furniture — a timestamp above, a source path
   * and page number below. The matrix spans pages, so that furniture lands *between* lap rows and
   * must be stepped over rather than read as the end of the table.
   */
  const pageTop = new Map<number, number>();
  const pageBottom = new Map<number, number>();
  for (const band of bands) {
    const top = pageTop.get(band.page);
    if (top === undefined || band.y > top) pageTop.set(band.page, band.y);
    const bottom = pageBottom.get(band.page);
    if (bottom === undefined || band.y < bottom) pageBottom.set(band.page, band.y);
  }
  const isPageFurniture = (band: MyRcmPdfBand): boolean =>
    band.y >= (pageTop.get(band.page) ?? Infinity) - BAND_TOLERANCE_PT ||
    band.y <= (pageBottom.get(band.page) ?? -Infinity) + BAND_TOLERANCE_PT;

  /** A section heading — "Analysis", "Consistency" — is where the lap matrix stops. */
  const isProse = (band: MyRcmPdfBand): boolean =>
    band.cells.some((cell) => /[A-Za-z]{3}/.test(cell.text));

  for (let i = fromBandIndex; i < bands.length; i += 1) {
    const band = bands[i] as MyRcmPdfBand;

    // The header repeats on every page the matrix spans, and re-opens it after a page break.
    if (isLapTableHeader(band)) {
      inLapTable = true;
      continue;
    }

    if (isPageFurniture(band)) continue;

    if (inLapTable && isProse(band)) {
      inLapTable = false;
      continue;
    }

    const times: Array<{ x: number; seconds: number }> = [];
    let leftmostTimeX = Number.POSITIVE_INFINITY;
    for (const cell of band.cells) {
      const seconds = lapCellSeconds(cell.text);
      if (seconds === null) continue;
      times.push({ x: cell.x, seconds });
      if (cell.x < leftmostTimeX) leftmostTimeX = cell.x;
    }

    // Bands without times are skipped, never treated as the end of the table: the matrix spans
    // pages and the page footer sits between its rows. Closing on the first non-time band cost the
    // qualy fixture 13 of its 25 laps.
    if (!times.length) continue;
    if (!inLapTable) continue;

    let lapNumber: number | null = null;
    for (const cell of band.cells) {
      if (cell.x >= leftmostTimeX) continue;
      if (!/^\d{1,3}$/.test(cell.text)) continue;
      lapNumber = Number.parseInt(cell.text, 10);
      break;
    }

    if (lapNumber !== null && lapNumber <= lastLapNumber && (current.length || currentStart)) {
      blocks.push({ rows: current, startRow: currentStart });
      current = [];
      currentStart = null;
    }
    if (lapNumber !== null) lastLapNumber = lapNumber;

    times.sort((a, b) => a.x - b.x);

    // The start segment: held aside, never a lap, added back only for the total.
    if (lapNumber === 0) {
      currentStart = { lapNumber, times };
      continue;
    }

    current.push({ lapNumber, times });
  }

  if (current.length || currentStart) blocks.push({ rows: current, startRow: currentStart });
  return blocks;
}

/**
 * Distinct column x positions in a block, left to right — one per driver the block covers.
 *
 * Clustered rather than matched exactly: the same table is rendered at x=274 on one page and
 * x=275 on another, and the two printings of the same data use different widths entirely.
 */
function columnsOf(block: LapBlock): number[] {
  const xs: number[] = [];
  for (const row of block.rows) {
    for (const t of row.times) {
      if (!xs.some((x) => Math.abs(x - t.x) <= COLUMN_SNAP_PT)) xs.push(t.x);
    }
  }
  return xs.sort((a, b) => a - b);
}

/** Read a run-result PDF that a driver downloaded from MyRCM. */
export function parseMyRcmPdfReport(cells: Array<MyRcmPdfCell & { page: number }>): MyRcmPdfReport {
  const bands = bandCells(cells);
  if (!bands.length) {
    throw new MyRcmPdfParseError("not_a_run_result", "There is no readable text in this PDF.");
  }

  const { drivers: classified, endBandIndex } = parseClassification(bands);

  // Header: "RUN RESULT" / session name / event · class · printed time.
  let sessionName: string | null = null;
  let eventName: string | null = null;
  let className: string | null = null;
  let sessionCompletedAtIso: string | null = null;

  const headerIndex = bands.findIndex((b) => /^RUN RESULT$/i.test(bandText(b).trim()));
  if (headerIndex >= 0) {
    const titleBand = bands[headerIndex + 1];
    if (titleBand) sessionName = bandText(titleBand).trim() || null;

    const metaBand = bands[headerIndex + 2];
    if (metaBand) {
      const rest: string[] = [];
      for (const cell of metaBand.cells) {
        const iso = parseMyRcmPdfDateTime(cell.text);
        if (iso && !sessionCompletedAtIso) sessionCompletedAtIso = iso;
        else rest.push(cell.text);
      }
      eventName = rest[0] ?? null;
      className = rest[1] ?? null;
    }
  }

  const blocks = parseLapBlocks(bands, endBandIndex);
  if (!blocks.length) {
    throw new MyRcmPdfParseError(
      "no_lap_matrix",
      "This report has no lap times in it. On MyRCM's download dialog, tick the lap list block before downloading."
    );
  }

  const lapsByPosition = new Map<number, number[]>();
  const startByPosition = new Map<number, number>();
  const issues: MyRcmPdfIssue[] = [];

  /**
   * Only drivers who actually ran get a column in the matrix.
   *
   * The qualy fixture is nine entrants, five of them DNS with `L` of 0 — and without this filter
   * the appendix re-print gets mistaken for "the next chunk of drivers" and hands the four real
   * drivers' laps to five people who never left the pits.
   */
  const columnBearing = classified.filter(
    (driver) => driver.statedLapCount > 0 && (driver.note ?? "").toUpperCase() !== "DNS"
  );

  let covered = 0;

  for (const block of blocks) {
    // Every driver who ran already has a column, so this block is the appendix re-print. Stop.
    if (covered >= columnBearing.length) break;

    const columns = columnsOf(block);
    const slice = columnBearing.slice(covered, covered + columns.length);
    if (!slice.length) break;

    if (columns.length > columnBearing.length - covered) {
      issues.push({
        position: 0,
        driverName: "—",
        kind: "lap_count",
        severity: "error",
        detail: `lap table has ${columns.length} columns but only ${columnBearing.length - covered} drivers left to fill them`,
      });
    }

    const driverAt = (x: number): (typeof slice)[number] | undefined => {
      for (let c = 0; c < columns.length; c += 1) {
        if (Math.abs((columns[c] as number) - x) <= COLUMN_SNAP_PT) return slice[c];
      }
      return undefined;
    };

    for (const row of block.rows) {
      for (const time of row.times) {
        const driver = driverAt(time.x);
        if (!driver) continue;
        const list = lapsByPosition.get(driver.position);
        if (list) list.push(time.seconds);
        else lapsByPosition.set(driver.position, [time.seconds]);
      }
    }

    // The start row can carry a cell for someone who never completed a lap, so it is matched to
    // the columns the lap rows established rather than being allowed to define columns of its own.
    for (const time of block.startRow?.times ?? []) {
      const driver = driverAt(time.x);
      if (!driver) continue;
      if (!startByPosition.has(driver.position)) startByPosition.set(driver.position, time.seconds);
    }

    covered += columns.length;
  }

  const drivers: MyRcmPdfDriver[] = classified.map((driver) => ({
    ...driver,
    laps: lapsByPosition.get(driver.position) ?? [],
    startSegmentSeconds: startByPosition.get(driver.position) ?? null,
  }));

  /**
   * The answer key.
   *
   * The file states every driver's total time, best lap and lap count. Measured across both
   * fixtures, the **sum of a driver's laps equals their printed total to the millisecond** — 12 of
   * 12 drivers, Δ 0.000 — which makes it the check worth trusting: it fails the moment a single
   * lap lands in the wrong column, since a column swap moves time between two drivers.
   *
   * Lap count does not have that property. It disagrees legitimately when the loop misses a
   * crossing, so it is reported and never enforced.
   */
  for (const driver of drivers) {
    if (!driver.laps.length) {
      if (driver.statedLapCount > 0) {
        issues.push({
          position: driver.position,
          driverName: driver.driverName,
          kind: "no_laps",
          severity: "error",
          detail: `states ${driver.statedLapCount} laps, none found`,
        });
      }
      continue;
    }

    if (driver.statedTotalSeconds !== null) {
      const sum =
        driver.laps.reduce((total, lap) => total + lap, 0) + (driver.startSegmentSeconds ?? 0);
      // Every lap is printed to a millisecond, so the slack only has to cover float addition.
      if (Math.abs(sum - driver.statedTotalSeconds) > 0.005) {
        const penalty = penaltySecondsFromTotals(sum, driver.statedTotalSeconds);
        if (penalty !== null) {
          driver.penaltySeconds = penalty;
          issues.push({
            position: driver.position,
            driverName: driver.driverName,
            kind: "penalty",
            severity: "warning",
            detail: `${penalty}s penalty — the file's total is ${penalty}s more than the laps; the laps are kept as driven`,
          });
        } else {
          issues.push({
            position: driver.position,
            driverName: driver.driverName,
            kind: "total_time",
            severity: "error",
            detail: `laps sum to ${sum.toFixed(3)}s, file states ${driver.statedTotalSeconds.toFixed(3)}s`,
          });
        }
      }
    }

    /**
     * The best lap must match either every lap, or every lap after the first.
     *
     * Where the opening part-lap lands depends on the event. TITC numbers it lap 0, so it is already
     * out of `laps` and the plain minimum is right. EFRA numbers it lap 1 and counts it in `L`, so
     * it sits inside `laps` at 16.505 against a 20.311 best — MyRCM keeps it in `TOTAL` but leaves
     * it out of `BEST`. Accepting either shape covers both without weakening the check: a column
     * swap moves a whole driver's times and produces a minimum that matches neither.
     */
    const fastest = Math.min(...driver.laps);
    const fastestAfterFirst = driver.laps.length > 1 ? Math.min(...driver.laps.slice(1)) : fastest;
    const stated = driver.statedBestLapSeconds;
    if (
      stated !== null &&
      Math.abs(fastest - stated) > 0.0005 &&
      Math.abs(fastestAfterFirst - stated) > 0.0005
    ) {
      issues.push({
        position: driver.position,
        driverName: driver.driverName,
        kind: "best_lap",
        severity: "error",
        detail: `states best ${stated.toFixed(3)}, read ${fastest.toFixed(3)}`,
      });
    }

    if (driver.statedLapCount > 0 && driver.laps.length !== driver.statedLapCount) {
      issues.push({
        position: driver.position,
        driverName: driver.driverName,
        kind: "lap_count",
        severity: "warning",
        detail: `states ${driver.statedLapCount} laps, ${driver.laps.length} printed — likely a missed transponder crossing`,
      });
    }
  }

  return {
    sessionName,
    eventName,
    className,
    sessionCompletedAtIso,
    drivers,
    reconciled: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}

/**
 * A time penalty, read off the arithmetic.
 *
 * The first refusal off a real race sheet (2026-08-29): "laps sum to 301.372s, file states
 * 311.372s" — ten seconds, to the millisecond. That is not a lap in the wrong column: a swapped
 * column moves a *lap time* between drivers and leaves a fractional gap, and the best-lap check
 * fires beside it. A gap that is a whole number of seconds, in the total's favour, is what a race
 * director's penalty looks like once MyRCM has added it to `TOTAL` and printed nothing else.
 *
 * Bounded at ten minutes: beyond that it is not a penalty, it is a broken read. Null for any gap
 * that is fractional, negative, or zero.
 */
export const MAX_PENALTY_SEC = 600;

export function penaltySecondsFromTotals(lapsSumSeconds: number, statedTotalSeconds: number): number | null {
  const gap = statedTotalSeconds - lapsSumSeconds;
  if (!(gap > 0.005) || gap > MAX_PENALTY_SEC) return null;
  const whole = Math.round(gap);
  if (whole < 1 || Math.abs(gap - whole) > 0.005) return null;
  return whole;
}

/** Normalisation used to match a driver to their row. Mirrors the other timing sources. */
export function normalizeMyRcmPdfName(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Stable parser id for a PDF-sourced import. Distinct from the dormant HTML reader's `myrcm`. */
// Declared in `myRcmPdfSource.ts` (client-safe, no parser) and re-exported here so every server
// caller keeps one import.
export { MYRCM_PDF_PARSER_ID };

/**
 * The driver's own row, matched by name.
 *
 * MyRCM publishes no driver id and no transponder in its results, so the name is the only handle
 * there has ever been — the same limitation the HTML reader had, and the reason Settings carries a
 * "name on MyRCM" override. Returns null rather than guessing: handing back row 1 would hand back
 * the session winner.
 */
export function selectMyRcmPdfDriver(
  report: MyRcmPdfReport,
  driverNames: string[] | undefined
): MyRcmPdfDriver | null {
  const wanted = (driverNames ?? [])
    .map((name) => normalizeMyRcmPdfName(name))
    .filter((name) => name.length > 0);
  if (!wanted.length) return null;

  for (const driver of report.drivers) {
    if (wanted.includes(normalizeMyRcmPdfName(driver.driverName))) return driver;
  }
  return null;
}

/**
 * The report in the shape every URL importer already returns.
 *
 * This is the whole integration: once a PDF becomes a `LapUrlParseResult`, `serializeParsePayload`,
 * the field-stats builder, the Engineer's session context and `linkImportedSessionsToRun` all work
 * on it untouched, and a PDF-sourced run is indistinguishable downstream from a LiveRC one.
 */
export function toLapUrlParseResult(
  report: MyRcmPdfReport,
  opts?: { driverNames?: string[] }
): LapUrlParseResult {
  const mine = selectMyRcmPdfDriver(report, opts?.driverNames);
  const warnings = report.issues.filter((issue) => issue.severity === "warning");

  return {
    parserId: MYRCM_PDF_PARSER_ID,
    laps: mine?.laps ?? [],
    sessionDrivers: toSessionDrivers(report),
    sessionHint: {
      name: report.sessionName,
      className: report.className,
    },
    sessionCompletedAtIso: report.sessionCompletedAtIso,
    message: warnings.length
      ? warnings.map((issue) => `${issue.driverName}: ${issue.detail}`).join(" · ")
      : null,
    ...(mine ? {} : { errorCode: "driver_not_found" }),
  };
}

/** The field, in the shape the import UI and `ImportedLapTimeSession` already speak. */
export function toSessionDrivers(report: MyRcmPdfReport): LapUrlSessionDriver[] {
  return report.drivers.map((driver) => ({
    id: `myrcm-pdf-p${driver.position}`,
    driverId: `myrcm-pdf-p${driver.position}`,
    driverName: driver.driverName,
    normalizedName: normalizeMyRcmPdfName(driver.driverName),
    laps: driver.laps,
    lapCount: driver.laps.length,
  }));
}
