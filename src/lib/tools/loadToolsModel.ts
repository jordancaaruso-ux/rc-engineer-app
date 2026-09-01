import "server-only";
import { prisma } from "@/lib/prisma";
import { formatRunDateOnly, formatRunTimeOnly } from "@/lib/formatDate";
import { formatLap } from "@/lib/runLaps";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { formatRunPickerParts, type RunPickerRun } from "@/lib/runPickerFormat";
import { normalizeSetupData } from "@/lib/runSetup";
import { canonicalSetupSheetTemplateId } from "@/lib/setupSheetTemplateId";
import {
  computeRollCenterFromSnapshot,
  deriveRollCenterInputs,
  solveRollCenterDiagram,
} from "@/lib/rollCenter/computeFromSnapshot";
import { chassisBottomAt, chassisPlateCorners } from "@/lib/rollCenter/engine";
import { DEFAULT_CHASSIS_HALF_WIDTH_MM, resolvePackForTemplateKey } from "@/lib/rollCenter/packs";
import { encodeLabSlot, extractGeometryFields } from "@/lib/rollCenter/labState";
import {
  MAX_UNLINKED_LAPS,
  MAX_VIDEO_JOBS,
  UNLINKED_LAP_WINDOW_DAYS,
  countDifferingBoxes,
  type ToolsCompare,
  type ToolsGeometry,
  type ToolsLapSession,
  type ToolsRollCentre,
  type ToolsModel,
  type ToolsVideoJob,
} from "@/lib/tools/toolsModel";

/**
 * Everything the Tools tab shows, in one read.
 *
 * Every band is seeded from the driver's own rows, because a page of doors with descriptions
 * under them is the thing this page replaced. That makes the read wider than a hub's — it
 * touches runs, snapshots, video jobs and imported sessions — so it is cached (30s, same as
 * Paddock) rather than run per navigation.
 *
 * NO `Date` LEAVES THIS FUNCTION. It is wrapped in `unstable_cache` by `getCachedToolsModel`,
 * which round-trips through JSON — a `Date` would come back a `Date` on a miss and a string on
 * a hit, with the type still claiming `Date`. Dates are formatted here, before the value is
 * ever stored.
 */
export async function loadToolsModel(input: {
  userId: string;
  timeZone: string;
}): Promise<ToolsModel> {
  const { userId, timeZone } = input;
  const unlinkedSince = new Date(Date.now() - UNLINKED_LAP_WINDOW_DAYS * 86_400_000);

  const [recentRuns, videoJobs, unlinkedLapRows, unlinkedLapTotal] = await Promise.all([
    /*
     * One scan of the recent past serves both the geometry band and the compare pair.
     *
     * `sortAt`, not `createdAt`: it is the stable ordering axis (see the three-timestamps note
     * in CLAUDE.md), so a re-imported day doesn't reshuffle which setup this page calls "latest".
     *
     * RUN_SCAN rows rather than the last two: a run can carry a snapshot with nothing filled in,
     * and a car can have one run while an older car has ten. Both are ordinary, and both need
     * more than two rows to answer.
     */
    prisma.run.findMany({
      where: { userId, carId: { not: null } },
      orderBy: { sortAt: "desc" },
      take: RUN_SCAN,
      select: {
        id: true,
        createdAt: true,
        sortAt: true,
        sessionLabel: true,
        sessionType: true,
        meetingSessionType: true,
        meetingSessionCode: true,
        eventId: true,
        event: { select: { name: true } },
        carId: true,
        carNameSnapshot: true,
        trackNameSnapshot: true,
        sessionCompletedAt: true,
        loggingCompletedAt: true,
        bestLapSeconds: true,
        track: { select: { name: true } },
        car: {
          select: {
            id: true,
            name: true,
            chassis: true,
            setupSheetTemplate: true,
            setupSheetModelId: true,
            setupSheetModel: { select: { name: true } },
          },
        },
        setupSnapshot: { select: { id: true, data: true } },
      },
    }),
    prisma.videoAnalysisJob.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: MAX_VIDEO_JOBS,
      select: {
        id: true,
        createdAt: true,
        status: true,
        resultJson: true,
        manualJson: true,
        runId: true,
        track: { select: { name: true } },
        run: { select: { sessionLabel: true } },
      },
    }),
    /*
     * Imported timing sessions with no run behind them, from the last fortnight.
     *
     * This is the band's whole reason to exist. `/laps/import` has never had a door in the nav —
     * the only way in is one link on a dashboard card — so a session imported and not attached
     * is invisible until you happen to pass that card again.
     *
     * The window is load-bearing, not tidiness: see `UNLINKED_LAP_WINDOW_DAYS`. Unbounded, this
     * band reported "500 more waiting" on a real account, because event-hub expansion stores
     * every race on the hub and almost none of them are yours to file.
     */
    prisma.importedLapTimeSession.findMany({
      where: { userId, linkedRunId: null, createdAt: { gte: unlinkedSince } },
      orderBy: [{ sessionCompletedAt: "desc" }, { createdAt: "desc" }],
      take: MAX_UNLINKED_LAPS,
      select: {
        id: true,
        createdAt: true,
        sessionCompletedAt: true,
        sourceUrl: true,
        eventDetectionSource: true,
        eventDetectionSessionLabel: true,
        eventRaceClass: true,
      },
    }),
    prisma.importedLapTimeSession.count({
      where: { userId, linkedRunId: null, createdAt: { gte: unlinkedSince } },
    }),
  ]);

  /*
   * Runs whose snapshot actually holds something, in the shapes the compare bench uses.
   *
   * `normalizeSetupData` here and not at the point of use: the bench normalizes every row it
   * loads, and the difference count on this page has to agree with the sheet the bench then
   * draws. Two normalisations, one on each side, is how the count and the sheet drift apart.
   */
  const comparable = recentRuns.flatMap((run) => {
    const modelId = run.car?.setupSheetModelId?.trim();
    const raw = run.setupSnapshot?.data;
    if (!modelId || !run.car || raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      return [];
    }
    const values = normalizeSetupData(raw) as Record<string, unknown>;
    if (!hasAnyValue(values)) return [];
    return [{ run, car: run.car, values, setupSheetModelId: modelId }];
  });

  return {
    geometry: buildGeometry(comparable, timeZone),
    compare: buildCompare(comparable, timeZone),
    video: videoJobs.map((job): ToolsVideoJob => {
      const label = job.run?.sessionLabel?.trim();
      return {
        id: job.id,
        title: [job.track?.name?.trim(), label].filter(Boolean).join(" — ") || "Video session",
        whenLabel: formatRunDateOnly(job.createdAt, timeZone),
        state:
          job.resultJson != null
            ? "analysed"
            : job.status === "FAILED"
              ? "failed"
              : "in-progress",
        // The run is where the result actually reads; the job page is the fallback for a
        // session that was never attached to one.
        href: job.runId
          ? `/runs/${encodeURIComponent(job.runId)}`
          : `/videos/analysis/jobs/${encodeURIComponent(job.id)}`,
      };
    }),
    unlinkedLaps: unlinkedLapRows.map(
      (row): ToolsLapSession => ({
        id: row.id,
        title: lapSessionTitle(row),
        detail: [
          // The on-track time when timing gave one, otherwise when it was imported. Never the
          // raw ISO — these are UTC machine timestamps.
          formatRunDateOnly(row.sessionCompletedAt ?? row.createdAt, timeZone),
          hostOf(row.sourceUrl),
        ]
          .filter(Boolean)
          .join(" · "),
        href: `/laps/analysis?session=${encodeURIComponent(row.id)}`,
      })
    ),
    unlinkedLapTotal,
  };
}

/**
 * How far back the run scan reaches.
 *
 * Big enough that a driver with three cars still finds two comparable runs on one of them,
 * small enough that the snapshots it pulls stay a reasonable payload — a sheet is ~300 boxes.
 */
const RUN_SCAN = 12;

/** A snapshot with every box empty is not a setup; the compare bench skips these too. */
function hasAnyValue(values: Record<string, unknown>): boolean {
  return Object.values(values).some((v) => {
    if (v == null) return false;
    if (typeof v === "string") return v.trim().length > 0;
    if (typeof v === "object") return Object.keys(v as object).length > 0;
    return true;
  });
}

/** `https://www.grccc.liverc.com/practice/…` → "grccc.liverc.com". */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * What to call a timing session on one line.
 *
 * `eventDetectionSessionLabel` is NOT a session label on a practice row — detection writes the
 * matched DRIVER name there, so using it first put "Jordan Caruso" at the top of every row on
 * the driver's own page (seen 2026-08-19). It is only the session's name on a race row, where
 * detection copies the LiveRC result link text ("Race 15: ISTC Modified").
 *
 * Everything else falls back to the kind of session it was, with the host on the line below.
 * A hostname is where a session came from, not what it is, and it made three different races
 * read as three copies of "tftr.liverc.com".
 */
function lapSessionTitle(row: {
  eventDetectionSource: string | null;
  eventDetectionSessionLabel: string | null;
  eventRaceClass: string | null;
}): string {
  const race = row.eventDetectionSource === "race";
  const label = race ? row.eventDetectionSessionLabel?.trim() : null;
  return (
    row.eventRaceClass?.trim() ||
    label ||
    (row.eventDetectionSource === "practice" ? "Practice session" : "Imported session")
  );
}

type Comparable = {
  run: {
    id: string;
    track: { name: string } | null;
  } & RunPickerRun;
  car: {
    id: string;
    name: string;
    chassis: string | null;
    setupSheetTemplate: string | null;
    setupSheetModel: { name: string } | null;
  };
  values: Record<string, unknown>;
  setupSheetModelId: string;
};

/**
 * The geometry band: where the most recently run car's roll centres actually sit.
 *
 * This is the one band that answers its question without opening anything, which is why it
 * leads. The Lab is a blank calculator today — you arrive and have to feed it a setup before
 * it says anything — and for the common question ("where am I now?") that is the whole job.
 *
 * `resolvePackForTemplateKey`, never `resolvePackForSnapshot`. The car is known here, and
 * sniffing field names would render Awesomatix hardpoints as some other brand's geometry:
 * confidently wrong numbers, which this app treats as the one unacceptable failure. One pack
 * exists, so most drivers get `reason: "no-pack"` and a Lab door instead of a readout — that
 * is the truth, and it is better said than papered over with defaults.
 */
function buildGeometry(comparable: Comparable[], timeZone: string): ToolsGeometry | null {
  const latest = comparable[0];
  if (!latest) return null;

  const { car } = latest;
  const chassisName = car.setupSheetModel?.name ?? car.chassis ?? null;
  const base: ToolsGeometry = {
    carId: car.id,
    carName: car.name,
    chassisName: chassisName && !isSameThing(car.name, chassisName) ? chassisName : null,
    rollCentre: null,
    reason: null,
  };

  const pack = resolvePackForTemplateKey(
    canonicalSetupSheetTemplateId(car.setupSheetTemplate ?? null)
  );
  if (!pack) return { ...base, reason: "no-pack" };

  const computed = computeRollCenterFromSnapshot(latest.values, pack);
  if (!computed) return { ...base, reason: "no-setup" };

  /*
   * The drawing, solved here rather than in the card.
   *
   * `solveRollCenterDiagram` returns the hardpoints the schematic draws, so the picture on the
   * band IS the solve that produced the three numbers beside it — not a second, decorative
   * rendering of the same car. It only ever returns null when the numbers above would have been
   * null too, so a failure here is a missing plate, never a missing band.
   */
  const solves = solveRollCenterDiagram(latest.values, pack);
  if (!solves) return { ...base, reason: "no-setup" };

  const parts = formatRunPickerParts(latest.run);
  const track = latest.run.track?.name?.trim();
  const sourceLabel = [parts.title, track].filter(Boolean).join(" — ");

  return {
    ...base,
    rollCentre: {
      frontMm: computed.front.rcHeightMm,
      rearMm: computed.rear.rcHeightMm,
      rakeMm: computed.rakeMm,
      frontSolve: solves.front,
      frontPlate: frontChassisPlate(latest.values, pack),
      sourceLabel: sourceLabel || formatRunDateOnly(latest.run.createdAt, timeZone),
      /*
       * Seeded with the run it came from, not just the geometry slice. The slice alone opens the
       * Lab in sliders-only mode; naming the source lets it fetch the whole setup and draw the
       * sheet, which is what makes "open the lab" continue this setup rather than start a blank.
       */
      labHref: `/analysis/roll-center?s=${encodeLabSlot({
        fields: extractGeometryFields(latest.values),
        setupSheetModelId: latest.setupSheetModelId,
        source: { kind: "run", id: latest.run.id },
      })}&sl=${encodeURIComponent((sourceLabel || car.name).slice(0, 60))}`,
    },
  };
}

/**
 * The chassis plate under the front-axle drawing, and the ride height it dimensions.
 *
 * Same construction as the Lab's, at the resting pose — no roll, no bump, because the band draws
 * the car as the setup describes it rather than a pose the driver chose. Width is DRAWN and never
 * solved: the A800 pack has never had one measured, so the plate comes back `measured: false` and
 * the schematic outlines it dashed. That is the honest rendering and it costs no number.
 */
function frontChassisPlate(
  values: Record<string, unknown>,
  pack: NonNullable<ReturnType<typeof resolvePackForTemplateKey>>
): ToolsRollCentre["frontPlate"] {
  const inputs = deriveRollCenterInputs(values, pack);
  if (!inputs) return null;
  const halfWidth = pack.chassisHalfWidthMm ?? DEFAULT_CHASSIS_HALF_WIDTH_MM;
  const baseThickness = pack.chassisOptions[pack.baseChassisCode]?.thicknessMm ?? 2;
  // Inboard of the plate edge, clear of the arms above and the roll-centre marker below.
  const rideAtX = -(halfWidth - 15);
  const rideTop = chassisBottomAt(pack.front, inputs.frontAdj, rideAtX);
  return {
    corners: chassisPlateCorners(pack.front, inputs.frontAdj, halfWidth, baseThickness),
    rideTop,
    rideAtX,
    rideHeightMm: rideTop.z,
    measured: pack.chassisHalfWidthMm != null,
  };
}

/**
 * The compare pair: your two most recent setups on one car, pre-filled.
 *
 * Scoped to a single car because the bench can only draw two setups on one sheet — a pair from
 * different chassis lands on "these don't share a sheet" and the pre-fill would have made the
 * page worse than a blank one. The first car with two comparable runs wins, so a driver whose
 * newest car has been out once still gets the band for the car they actually campaign.
 *
 * `entryId` is the bench's own id format. Nothing new is stored, and no second vocabulary
 * exists — the link fills in the two slots a driver would have filled in themselves.
 */
function buildCompare(comparable: Comparable[], timeZone: string): ToolsCompare | null {
  const byCar = new Map<string, Comparable[]>();
  for (const row of comparable) {
    const list = byCar.get(row.car.id) ?? [];
    list.push(row);
    byCar.set(row.car.id, list);
  }

  // Insertion order is `sortAt` order, so the first car to reach two is the most recent one
  // that can fill both slots.
  const pair = [...byCar.values()].find((rows) => rows.length >= 2);
  if (!pair) return null;

  const [a, b] = pair;
  if (!a || !b) return null;

  /*
   * The detail line's job is to tell the two apart, which is harder than it looks.
   *
   * `formatRunPickerParts` gives "Testing" as the title for any testing run with no session
   * label — which is most of them — so two runs from the same day at the same track came out as
   * two identical rows (seen 2026-08-19). Track and date do not separate them either: two runs
   * on one day share both.
   *
   * The time of day always differs, so it goes first and is never dropped. The best lap follows
   * where there is one, because it is the figure that says which of the two was the better car.
   */
  const side = (row: Comparable) => {
    const parts = formatRunPickerParts(row.run);
    const instant = resolveRunDisplayInstant({
      createdAt: row.run.createdAt,
      sessionCompletedAt: row.run.sessionCompletedAt ?? null,
      loggingCompletedAt: row.run.loggingCompletedAt ?? null,
    });
    const best = row.run.bestLapSeconds;
    return {
      entryId: `run-${row.run.id}`,
      label: parts.title,
      detail: [
        formatRunDateOnly(instant, timeZone),
        formatRunTimeOnly(instant, timeZone),
        best != null ? formatLap(best) : null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  };

  return {
    a: side(a),
    b: side(b),
    differingBoxes: countDifferingBoxes(a.values, b.values),
  };
}

/**
 * Whether the chassis line would just repeat the car's name.
 *
 * Same loose test as the Paddock car cards, and deliberately a copy rather than an import:
 * it is four lines of string comparison, and the two surfaces answering it identically matters
 * more than the two surfaces sharing a function.
 */
function isSameThing(carName: string, chassisName: string): boolean {
  const a = carName.trim().toLowerCase();
  const b = chassisName.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || b.includes(a) || a.includes(b);
}
