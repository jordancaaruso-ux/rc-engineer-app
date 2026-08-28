/**
 * Run: `npm run test:myrcm-pdf`
 *
 * (`node --conditions=react-server --import tsx` — `myRcmPdfText.ts` is `server-only`.)
 *
 * Fixtures are real files downloaded with MyRCM's own "Download PDF" button on 2026-08-26/27, from
 * LS Club Day (event 96077, raced 23.08.2026). Nothing was edited; they are the bytes a driver
 * would hand us.
 *
 *  - myrcm-pdf-final-8drivers.pdf  → Finals A. 8 drivers, 78 laps, one retirement at lap 47, so the
 *                                    lap matrix loses columns from the right as the race runs on.
 *                                    Every lap is printed twice (list + appendix).
 *  - myrcm-pdf-qualy-4drivers.pdf  → Heat 1 Qualy 1. 9 entrants, 5 of them DNS — the case that
 *                                    fooled an earlier cut of the parser into handing the appendix
 *                                    re-print to drivers who never left the pits. P1 also has a
 *                                    genuine missed transponder crossing.
 *  - myrcm-pdf-summary-nolaps.pdf  → an event summary rather than a run: no lap matrix at all.
 *                                    The driver has to download an individual run.
 *  - myrcm-pdf-final-baretimes.pdf → EFRA European Championship (event 98914, E10 TC SPEC, Finals H
 *                                    run 3). **The second lap-cell format**: bare `16.505` with no
 *                                    `(n)` position bracket. A reader that only knows the bracketed
 *                                    form reports "no lap times in this file" for every event that
 *                                    prints this way, which is most of European racing. Also a
 *                                    rolling start, so lap 1 is a part-lap from the start line.
 *  - myrcm-pdf-final-startrow.pdf  → TITC Thailand (event 94266, Touring Car Open BL, Finals A run
 *                                    1). 10 drivers, and a **real lap 0** — the start segment,
 *                                    ~10s, which MyRCM counts in TOTAL but not in L. Discarding it
 *                                    left every driver in the field ten seconds short.
 *
 * The assertions below are the values printed in the documents themselves, so this file fails if a
 * future MyRCM layout change moves a lap into the wrong driver's column — which is the whole point
 * of it existing.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  bandCells,
  parseMyRcmPdfDateTime,
  parseMyRcmPdfReport,
  parseMyRcmPdfTime,
  toSessionDrivers,
  toLapUrlParseResult,
  selectMyRcmPdfDriver,
  MYRCM_PDF_PARSER_ID,
  MyRcmPdfParseError,
  type MyRcmPdfReport,
} from "@/lib/lapUrlParsers/myRcmPdf";
import { extractMyRcmPdfCells, looksLikePdf, MyRcmPdfReadError } from "@/lib/lapUrlParsers/myRcmPdfText";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixtureBytes = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(HERE, "__fixtures__", name)));

const read = async (name: string): Promise<MyRcmPdfReport> =>
  parseMyRcmPdfReport(await extractMyRcmPdfCells(fixtureBytes(name)));

const FINAL = "myrcm-pdf-final-8drivers.pdf";
const QUALY = "myrcm-pdf-qualy-4drivers.pdf";
const SUMMARY = "myrcm-pdf-summary-nolaps.pdf";
const BARE = "myrcm-pdf-final-baretimes.pdf";
const STARTROW = "myrcm-pdf-final-startrow.pdf";

test("parseMyRcmPdfTime reads both lap-time shapes and refuses the staging zeros", () => {
  assert.equal(parseMyRcmPdfTime("22.013"), 22.013);
  assert.equal(parseMyRcmPdfTime("1:02.345"), 62.345);
  assert.equal(parseMyRcmPdfTime("22,013"), 22.013);
  assert.equal(parseMyRcmPdfTime("0.000"), null);
  assert.equal(parseMyRcmPdfTime("0:00.000"), null);
  assert.equal(parseMyRcmPdfTime("-"), null);
  assert.equal(parseMyRcmPdfTime(""), null);
});

test("parseMyRcmPdfDateTime treats the printed time as UTC", () => {
  assert.equal(parseMyRcmPdfDateTime("23.08.2026 14:49:21"), "2026-08-23T14:49:21.000Z");
  assert.equal(parseMyRcmPdfDateTime("23.08.2026"), "2026-08-23T00:00:00.000Z");
  assert.equal(parseMyRcmPdfDateTime("not a date"), null);
});

test("bandCells groups a lap number with its row despite the sub-point offset", () => {
  // Taken from the real geometry: the lap number sits 0.7pt below the cells it labels.
  const bands = bandCells([
    { page: 1, x: 105.5, y: 1108.6, text: "(2) 24.321" },
    { page: 1, x: 61.5, y: 1107.9, text: "1" },
    { page: 1, x: 61.5, y: 1076.4, text: "2" },
    { page: 1, x: 105.5, y: 1076.4, text: "(2) 22.717" },
  ]);
  assert.equal(bands.length, 2);
  assert.deepEqual(
    bands[0]?.cells.map((c) => c.text),
    ["1", "(2) 24.321"],
    "left to right within the band"
  );
  assert.deepEqual(bands[1]?.cells.map((c) => c.text), ["2", "(2) 22.717"]);
});

test("looksLikePdf gates on the magic bytes", () => {
  assert.equal(looksLikePdf(fixtureBytes(FINAL)), true);
  assert.equal(looksLikePdf(new TextEncoder().encode("<html>nope</html>")), false);
  assert.equal(looksLikePdf(new Uint8Array([])), false);
});

test("a non-PDF is refused before parsing", async () => {
  await assert.rejects(
    () => extractMyRcmPdfCells(new TextEncoder().encode("<html>a saved web page</html>")),
    (error: unknown) => error instanceof MyRcmPdfReadError && error.code === "not_a_pdf"
  );
});

test("a PDF that stopped downloading is named as incomplete, not guessed at", async () => {
  /*
   * The refusal used to be one blind `catch` reading "damaged or password-protected" — a guess,
   * shown to a driver whose file opened fine on their phone (2026-08-27). pdfjs names the
   * failure; a half-arrived file is `InvalidPDFException` and now says so.
   */
  const whole = fixtureBytes(FINAL);
  const half = whole.slice(0, Math.floor(whole.length * 0.6));
  await assert.rejects(
    () => extractMyRcmPdfCells(half),
    (error: unknown) => error instanceof MyRcmPdfReadError && error.code === "damaged"
  );
});

test("the final reads its header", async () => {
  const report = await read(FINAL);
  assert.equal(report.sessionName, "Finals A");
  assert.equal(report.eventName, "LS Club Day");
  assert.equal(report.className, "1/5th Scale");
  assert.equal(report.sessionCompletedAtIso, "2026-08-23T14:49:21.000Z");
});

test("the final reconciles every driver against the file's own answer key", async () => {
  const report = await read(FINAL);
  assert.equal(report.reconciled, true);
  assert.deepEqual(report.issues, []);
});

test("the final's classification is the whole field, in order", async () => {
  const report = await read(FINAL);
  assert.deepEqual(
    report.drivers.map((d) => [d.position, d.carNumber, d.driverName]),
    [
      [1, "3", "Craig Hawkins"],
      [2, "6", "Chris Reinders"],
      [3, "4", "Gavin Drew"],
      [4, "5", "Carl Macleod"],
      [5, "7", "Paul Karatzas"],
      [6, "8", "Ed Floro"],
      [7, "2", "Bill Vartanian"],
      [8, "1", "Brad Smith"],
    ]
  );
  // The club is printed under the name and must not be swept into it.
  assert.equal(report.drivers[0]?.club, "NSWRCRCC");
  assert.equal(report.drivers[1]?.club, null, "Chris Reinders has no club on the sheet");
});

test("the final's laps land on the right driver, not doubled and not shuffled", async () => {
  const report = await read(FINAL);

  assert.deepEqual(
    report.drivers.map((d) => d.laps.length),
    [78, 78, 77, 75, 74, 70, 69, 47],
    "every lap is printed twice in the file; the appendix must not be counted"
  );

  assert.deepEqual(
    report.drivers.map((d) => Math.min(...d.laps).toFixed(3)),
    ["22.013", "22.120", "22.339", "22.293", "22.306", "23.337", "22.118", "21.810"]
  );

  // The load-bearing one. `(1)` in a cell is the running position after that lap, not the driver,
  // and the fastest lap of the race belongs to the driver who finished last.
  const brad = report.drivers[7];
  assert.equal(brad?.driverName, "Brad Smith");
  assert.equal(brad?.laps[8]?.toFixed(3), "21.810", "Brad's lap 9 is the fastest lap of the race");

  for (const driver of report.drivers) {
    const sum = driver.laps.reduce((total, lap) => total + lap, 0);
    assert.ok(
      Math.abs(sum - (driver.statedTotalSeconds ?? 0)) < 0.005,
      `${driver.driverName}: laps sum to ${sum.toFixed(3)}, file states ${driver.statedTotalSeconds}`
    );
  }
});

test("the qualy keeps DNS entrants out of the lap matrix", async () => {
  const report = await read(QUALY);

  assert.equal(report.sessionName, "Heat 1 Qualy 1");
  assert.equal(report.drivers.length, 9, "nine entered");

  const withLaps = report.drivers.filter((d) => d.laps.length > 0);
  assert.deepEqual(
    withLaps.map((d) => d.driverName),
    ["Gavin Drew", "Ed Floro", "Keith Mealey", "Guillaume Michal"],
    "only the four who ran"
  );

  const dns = report.drivers.slice(4);
  assert.ok(dns.every((d) => d.note === "DNS"), "the rest are marked DNS on the sheet");
  assert.ok(
    dns.every((d) => d.laps.length === 0),
    "an earlier cut handed these five the appendix re-print of the four real drivers' laps"
  );
});

test("a missed transponder crossing warns rather than blocking the import", async () => {
  const report = await read(QUALY);

  assert.equal(report.reconciled, true, "warnings must not block a good import");

  const warnings = report.issues.filter((i) => i.severity === "warning");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.kind, "lap_count");
  assert.equal(warnings[0]?.driverName, "Gavin Drew");

  // Why it is only a warning: his laps still sum to his printed total exactly.
  const gavin = report.drivers[0];
  assert.equal(gavin?.statedLapCount, 27);
  assert.equal(gavin?.laps.length, 25);
  const sum = (gavin?.laps ?? []).reduce((total, lap) => total + lap, 0);
  assert.ok(Math.abs(sum - (gavin?.statedTotalSeconds ?? 0)) < 0.005);
});

test("the bare-time format reads, and the analysis pages don't leak into it", async () => {
  const report = await read(BARE);

  assert.equal(report.sessionName, "Finals H Final run 3");
  assert.equal(report.eventName, "EC 1/10 TC electric");
  assert.equal(report.className, "E10 TC SPEC");
  assert.equal(report.reconciled, true);

  assert.deepEqual(
    report.drivers.map((d) => [d.driverName, d.laps.length]),
    [
      ["Peter Knudsen", 15],
      ["Kent Bertilsson", 15],
      ["Ioannis Nerantzis", 15],
      ["Victor Deram", 15],
      ["Nicolas Duponchelle", 14],
      ["Patrick Kölliker", 0],
    ],
    "exact counts — the consistency and gap pages further down also hold per-lap figures, and " +
      "reading those as laps inflates the count without breaking anything visibly"
  );
});

test("a rolling start's part-lap counts toward the total but not the best", async () => {
  const report = await read(BARE);
  const winner = report.drivers[0];

  // Measured from the start line, not a full lap — quicker than anything possible on this track.
  assert.equal(winner?.laps[0]?.toFixed(3), "16.505");
  assert.equal(winner?.statedBestLapSeconds, 20.311);

  const sum = (winner?.laps ?? []).reduce((total, lap) => total + lap, 0);
  assert.ok(
    Math.abs(sum - (winner?.statedTotalSeconds ?? 0)) < 0.005,
    "MyRCM counts the opening part-lap in the total, so we must too"
  );

  assert.equal(report.reconciled, true, "but it must not be reported as a wrong best lap");
});

test("a standing start's lap 0 counts toward the total but is not a lap", async () => {
  const report = await read(STARTROW);

  assert.equal(report.eventName, "TITC (21st THAILAND Int'l RC Touring Car Championship 2026)");
  assert.equal(report.drivers.length, 10);
  assert.equal(report.reconciled, true);

  const winner = report.drivers[0];
  assert.equal(winner?.driverName, "Ellerbrock Lukas");
  assert.equal(winner?.laps.length, 20, "L says 20 and lap 0 must not make it 21");
  assert.equal(winner?.startSegmentSeconds?.toFixed(3), "9.431");

  // The whole point: without adding the start segment back, every driver is ~10s short.
  const sum = (winner?.laps ?? []).reduce((total, lap) => total + lap, 0);
  assert.ok(
    Math.abs(sum + (winner?.startSegmentSeconds ?? 0) - (winner?.statedTotalSeconds ?? 0)) < 0.005
  );
  assert.ok(
    Math.abs(sum - (winner?.statedTotalSeconds ?? 0)) > 9,
    "and it really is the start segment that closes the gap, not rounding"
  );

  // A driver who took the start and completed nothing gets neither laps nor a phantom column.
  const last = report.drivers[9];
  assert.equal(last?.laps.length, 0);
  assert.equal(last?.startSegmentSeconds, null);
});

test("an event summary is refused with something the driver can act on", async () => {
  await assert.rejects(
    () => read(SUMMARY),
    (error: unknown) => {
      assert.ok(error instanceof MyRcmPdfParseError);
      assert.ok(
        error.code === "no_lap_matrix" || error.code === "no_classification",
        `unexpected code ${error.code}`
      );
      assert.match(error.message, /run/i, "the message must say to download a single run");
      return true;
    }
  );
});

test("the driver's own row is matched by name, or not at all", async () => {
  const report = await read(STARTROW);

  assert.equal(selectMyRcmPdfDriver(report, ["Caruso Jordan"])?.position, 5);
  assert.equal(
    selectMyRcmPdfDriver(report, ["caruso  JORDAN"])?.position,
    5,
    "case and spacing are normalised, as with every other timing source"
  );
  assert.equal(selectMyRcmPdfDriver(report, ["Someone Else"]), null);
  assert.equal(
    selectMyRcmPdfDriver(report, []),
    null,
    "never fall back to row 1 — that is the session winner"
  );
});

test("the report becomes the same parse result every URL importer returns", async () => {
  const report = await read(STARTROW);
  const parsed = toLapUrlParseResult(report, { driverNames: ["Caruso Jordan"] });

  assert.equal(parsed.parserId, MYRCM_PDF_PARSER_ID);
  assert.equal(parsed.laps.length, 19, "the driver's own laps");
  assert.equal(parsed.sessionDrivers?.length, 10, "and the whole field alongside them");
  assert.equal(parsed.sessionHint?.className, "Touring Car Open BL");
  assert.equal(parsed.sessionCompletedAtIso, report.sessionCompletedAtIso);
  assert.equal(parsed.errorCode, undefined);
});

test("an unmatched name yields no laps and says why", async () => {
  const report = await read(STARTROW);
  const parsed = toLapUrlParseResult(report, { driverNames: ["Not Racing Here"] });

  assert.deepEqual(parsed.laps, []);
  assert.equal(parsed.errorCode, "driver_not_found");
  assert.equal(parsed.sessionDrivers?.length, 10, "the field still comes through so they can pick");
});

test("a non-blocking warning is carried through to the import message", async () => {
  const parsed = toLapUrlParseResult(await read(QUALY), { driverNames: ["Ed Floro"] });
  assert.match(String(parsed.message), /Gavin Drew/);
  assert.equal(parsed.laps.length, 26, "and the warning is about someone else's row, not theirs");
});

test("the field converts to the shape the import already speaks", async () => {
  const report = await read(FINAL);
  const drivers = toSessionDrivers(report);

  assert.equal(drivers.length, 8);
  assert.deepEqual(drivers[0], {
    id: "myrcm-pdf-p1",
    driverId: "myrcm-pdf-p1",
    driverName: "Craig Hawkins",
    normalizedName: "craig hawkins",
    laps: report.drivers[0]?.laps,
    lapCount: 78,
  });
  assert.equal(new Set(drivers.map((d) => d.id)).size, 8, "ids are unique across the field");
});
