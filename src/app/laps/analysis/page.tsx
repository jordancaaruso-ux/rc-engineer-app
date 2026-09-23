import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getKnownCompetitorsSetting, getMyNameSetting } from "@/lib/appSettings";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { toCompareRunShape } from "@/lib/runCompareShape";
import { loadImportedSessionAnchor } from "@/lib/lapImport/importedSessionAnchor";
import {
  loadSessionNames,
  loadSessionNamingViewer,
  SESSION_NAMING_SELECT,
} from "@/lib/lapImport/loadSessionNames";
import { LapAnalysisBoard } from "@/components/laps/LapAnalysisBoard";
import { LapAnalysisLibrary } from "@/components/laps/LapAnalysisLibrary";
import { CompetitorPracticePull } from "@/components/laps/CompetitorPracticePull";
import { parseKnownCompetitorsSetting } from "@/lib/speedhive/knownCompetitors";
import { practiceFieldSourcesForTrack } from "@/lib/practiceField/loadPracticeField";
import { calendarYmdInTimeZone } from "@/lib/formatDate";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { SessionTitleEditor } from "@/components/laps/SessionTitleEditor";
import { DeleteSessionButton } from "@/components/laps/DeleteSessionButton";

/**
 * Lap time analysis — the sheet, with or without a run behind it.
 *
 * Three states, one route:
 *   ?session=<import>  a timing sheet nobody here necessarily drove
 *   ?run=<run>         one of your own sessions, opened full-page from its pop-up
 *   (neither)          the library: bring one in, or pick one to open
 *
 * `?target=` and `?columns=` restore what was on screen when the pop-up handed over, so
 * "Detailed analysis" is a change of room rather than a change of subject.
 */

export const dynamic = "force-dynamic";

/** Same list the compare pickers use elsewhere. */
const PICKER_RUNS_TAKE = 200;

const analysisRunSelect = {
  id: true,
  userId: true,
  createdAt: true,
  sortAt: true,
  importedLapTimeSessionId: true,
  sessionCompletedAt: true,
  loggingCompletedAt: true,
  sessionType: true,
  meetingSessionType: true,
  meetingSessionCode: true,
  sessionLabel: true,
  eventId: true,
  carId: true,
  carNameSnapshot: true,
  trackNameSnapshot: true,
  lapTimes: true,
  lapSession: true,
  bestLapSeconds: true,
  avgTop5LapSeconds: true,
  notes: true,
  driverNotes: true,
  handlingProblems: true,
  tireStintId: true,
  tireAgeKnown: true,
  tireRunNumber: true,
  warmerTimingMinutes: true,
  tirePrep: true,
  car: { select: { id: true, name: true, setupSheetTemplate: true, setupSheetModelId: true } },
  track: { select: { id: true, name: true } },
  tireType: { select: { id: true, displayName: true } },
  additiveType: { select: { id: true, displayName: true } },
  event: { select: { name: true } },
  setupSnapshot: { select: { id: true } },
  importedLapSets: {
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true,
      createdAt: true,
      sessionCompletedAt: true,
      sourceUrl: true,
      driverId: true,
      driverName: true,
      displayName: true,
      normalizedName: true,
      isPrimaryUser: true,
      laps: {
        orderBy: { lapNumber: "asc" as const },
        select: { lapNumber: true, lapTimeSeconds: true, isIncluded: true },
      },
    },
  },
} satisfies Prisma.RunSelect;

function firstParam(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0]?.trim() || null;
  return v?.trim() || null;
}

/** `columns=a,b,c` — ids the grid minted, handed straight back to it. */
function parseColumns(v: string | string[] | undefined): string[] | undefined {
  const raw = firstParam(v);
  if (!raw) return undefined;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

/** The timing site, the way a driver would say it. */
const TIMING_SOURCE_LABEL: Record<string, string> = {
  liverc: "LiveRC",
  myrcm: "MyRCM",
  speedhive: "MYLAPS",
};

function Shell({
  title,
  titleSlot,
  backHref,
  wide = false,
  children,
}: {
  title: string;
  /** Replaces the plain title — an imported session's title is also where it is renamed. */
  titleSlot?: ReactNode;
  backHref: string;
  /**
   * The sheet states take the dashboard's 1760px axis (`laps-wide`): lap columns keep
   * their width and the cap decides how many fit before the sideways scroll. The library
   * is a list to read and keeps the 72rem column.
   */
  wide?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <>
      {/*
       * `back-in-column` + a clamp on the body: the two halves of one fix.
       *
       * Unclamped, the column ran the full width of a 1440 monitor and the title
       * sat against the screen edge with the arrow further out still, floating on
       * its own. The clamp centres the column and `.page-header` mirrors it off
       * its next sibling automatically (see the `:has(+ .page-body.max-w-6xl)`
       * rule), so the title, the arrow and the cards all land on one axis.
       *
       * The library keeps 6xl, the pop-up's own width. The SHEET states take `laps-wide`
       * (the dashboard's 1760px axis) instead — clamped to 72rem, the rail and three lap
       * columns sat in the middle third of a 1440 monitor with paper either side, and
       * "hardly any of the screen is used" (founder call, 2026-08-27). The header mirrors
       * either cap off its next sibling, so the title stays on the cards' axis both ways.
       */}
      <header className="page-header back-in-column">
        <PageBackLink href={backHref} />
        <div className="min-w-0">
          {/*
           * A two-line clamp and `overflow-wrap: anywhere`, because this title is not ours: it
           * is whatever the timing site called the session. Most are short ("ISTC Modified
           * A-Main"), and then one arrives as a 40-character filename with no spaces in it.
           * `break-words` is not enough for that — it only breaks BETWEEN words, so a single
           * long token still walked out through the back arrow at desktop widths.
           *
           * `max-w-full` is the other half: `.page-title` is `width: fit-content`, so it sizes
           * to its text and happily exceeds its parent — no wrapping rule can fire while the
           * box is allowed to be wider than the screen.
           *
           * Not a fix for the PHONE, where the fixed chrome draws its own `.page-title-condensed`
           * over this one and truncates it: that is app-wide behaviour for any long page title,
           * and it is not this page's to change.
           */}
          {titleSlot ?? (
            <h1 className="page-title max-w-full [overflow-wrap:anywhere]">{title}</h1>
          )}
        </div>
      </header>
      {/*
       * No line of copy under the title: the library's went (founder call, 2026-09-24), and a
       * session's context line (track · when · drivers · source) is drawn inside
       * `LapAnalysisBoard`, so its clock is the browser's and matches the grid's.
       */}
      <section className={wide ? "page-body laps-wide" : "page-body max-w-6xl"}>{children}</section>
    </>
  );
}

export default async function LapAnalysisPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <Shell title="Lap time analysis" backHref="/tools">
        <p className="text-sm text-muted-foreground">Set DATABASE_URL to use this feature.</p>
      </Shell>
    );
  }

  const search = (await props.searchParams) ?? {};
  const sessionId = firstParam(search.session);
  const runId = firstParam(search.run);
  const initialTargetId = firstParam(search.target) ?? undefined;
  const initialComparisonIds = parseColumns(search.columns);
  const eventId = firstParam(search.eventId);

  const user = await requireCurrentUser();

  if (sessionId) {
    /*
     * Every name timing might print the viewer under. A race they DID enter should open on
     * their own row rather than the winner's, and this is the only thread connecting an
     * imported sheet back to the person reading it — an import has no user column beyond
     * who happened to fetch it. The same viewer names the session and the viewer's own runs.
     */
    const viewer = await loadSessionNamingViewer(user.id);

    const anchor = await loadImportedSessionAnchor(user.id, sessionId, { viewerNames: [...viewer.names] });
    if (!anchor) notFound();

    /*
     * The session's name: whose it is and which run of the day, a race's own name, or what the
     * driver typed (founder calls, 2026-09-23). Worked out with the rest of its day, the same way
     * the Tools card and the library name it, so all three agree.
     */
    const namingRow = await prisma.importedLapTimeSession.findFirst({
      where: { id: sessionId, userId: user.id },
      select: {
        ...SESSION_NAMING_SELECT,
        linkedRunId: true,
        detectedPrimaryForRun: { select: { id: true } },
      },
    });
    const name = namingRow
      ? ((
          await loadSessionNames({
            userId: user.id,
            rows: [namingRow],
            timeZone: user.timeZone?.trim() || null,
            viewer,
          })
        ).get(sessionId) ?? null)
      : null;
    const title = name?.title ?? anchor.title;
    // A session on a run holds that run's laps: the run is what gets deleted, not this.
    const onRun = Boolean(namingRow?.linkedRunId || namingRow?.detectedPrimaryForRun);
    /*
     * The sheet compares within its track only (founder call, 2026-09-24). A loose import has no
     * run or event to take a track from; the namer's lookup — the sweep's track, the practice
     * list's, the club whose LiveRC address matches — gives it the same one its heading shows.
     */
    const trackName = anchor.trackName ?? name?.trackName ?? null;
    const sourceWord = anchor.sourceLabel ? (TIMING_SOURCE_LABEL[anchor.sourceLabel] ?? null) : null;
    /*
     * Formatted here, on the track's clock, rather than in the browser: the board's own line
     * read the session time in the phone's zone, which for a LiveRC time (stored as the track's
     * clock) printed hours out. An explicit clock renders the same on the server and the phone.
     */
    const context = name
      ? [
          name.isCustom ? name.autoTitle : null,
          name.place,
          name.timeLabel ? `${name.dayLabel} · ${name.timeLabel}` : name.dayLabel,
          anchor.driverCount > 1 ? `${anchor.driverCount} drivers` : null,
          sourceWord && sourceWord !== name.place ? sourceWord : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

    /*
     * A race opens on its whole field, in finishing order (founder call, 2026-08-27). The
     * other drivers on the sheet are the reason it was opened; a sheet showing one column
     * and a picker is a sheet you have to build before you can read it. `?columns=` still
     * wins, so a hand-over from elsewhere restores exactly what was on screen there.
     */
    const wholeField = (anchor.run.importedLapSets ?? [])
      .filter((set) => !set.isPrimaryUser)
      .map((set) => `imported:${set.id}`);

    const myRuns = await prisma.run.findMany({
      where: { userId: user.id },
      orderBy: { sortAt: "desc" },
      take: PICKER_RUNS_TAKE,
      select: analysisRunSelect,
    });

    return (
      <Shell
        title={title}
        titleSlot={
          <SessionTitleEditor
            sessionId={sessionId}
            title={title}
            autoTitle={name?.autoTitle ?? anchor.title}
          />
        }
        backHref="/laps/analysis"
        wide
      >
        <LapAnalysisBoard
          /* The sheet names its column after the DRIVER already; its session line wants the
             run ("Run 3", the race, or what the driver typed), not the name a second time. */
          run={{
            ...anchor.run,
            sessionLabel: name?.label ?? anchor.title,
            trackNameSnapshot: anchor.run.trackNameSnapshot ?? trackName,
          }}
          otherRuns={myRuns.map(toCompareRunShape)}
          runListSource="my_runs"
          primaryDriverName={anchor.anchorDriverName}
          primaryIsViewer={anchor.anchorIsViewer}
          viewerName={viewer.displayName}
          initialTargetId={initialTargetId}
          initialComparisonIds={initialComparisonIds ?? wholeField}
          trackName={trackName}
          whenIso={anchor.whenIso}
          driverCount={anchor.driverCount}
          sourceLabel={anchor.sourceLabel}
          context={context}
          trackClockIso={name?.trackClockIso ?? null}
        />
        {onRun ? null : <DeleteSessionButton sessionId={sessionId} />}
      </Shell>
    );
  }

  if (runId) {
    const run = await prisma.run.findFirst({
      // Own runs only. The pop-up on a teammate's shared session keeps its own door
      // shut rather than reaching for a page that would have to re-derive their access.
      where: { id: runId, userId: user.id },
      select: analysisRunSelect,
    });
    if (!run) notFound();

    const pickerSource = await prisma.run.findMany({
      where: { userId: user.id, carId: run.carId ?? undefined },
      orderBy: { sortAt: "desc" },
      take: PICKER_RUNS_TAKE,
      select: analysisRunSelect,
    });

    const myName = await getMyNameSetting(user.id);
    const session = formatRunSessionDisplay(run, { fallback: "Lap times" });

    return (
      <Shell title={session} backHref={`/runs/${run.id}`} wide>
        <LapAnalysisBoard
          run={{ ...toCompareRunShape(run), importedLapSets: run.importedLapSets }}
          otherRuns={pickerSource.map(toCompareRunShape)}
          runListSource="my_runs"
          primaryDriverName={myName}
          primaryIsViewer
          initialTargetId={initialTargetId}
          initialComparisonIds={initialComparisonIds}
          /* Car doubles as the "track" slot here — the run already names its own session
             in the title, so the line beside it carries what the title cannot. */
          trackName={[
            run.car?.name ?? run.carNameSnapshot ?? null,
            run.track?.name ?? run.trackNameSnapshot ?? null,
          ]
            .filter(Boolean)
            .join(" · ")}
          whenIso={resolveRunDisplayInstant(run).toISOString()}
        />
      </Shell>
    );
  }

  /*
   * The practice card's two ingredients. Tracks are cut twice: to the ones with a LiveRC or MYLAPS
   * link, because those are the only ones that can be looked in; and to the viewer's own — run
   * at, created or favourited — because the catalog holds a thousand LiveRC clubs and a dropdown
   * of all of them is a dropdown nobody can use.
   */
  const [competitors, timingTracks] = await Promise.all([
    getKnownCompetitorsSetting(user.id).then(parseKnownCompetitorsSetting),
    prisma.track.findMany({
      where: {
        AND: [
          { OR: [{ liveRcUrl: { not: null } }, { speedhiveUrl: { not: null } }] },
          {
            OR: [
              { runs: { some: { userId: user.id } } },
              { favouriteTracks: { some: { userId: user.id } } },
              { userId: user.id, catalogSource: null },
            ],
          },
        ],
      },
      orderBy: { name: "asc" },
      take: 300,
      select: { id: true, name: true, liveRcUrl: true, speedhiveUrl: true },
    }),
  ]);

  const practiceTracks = timingTracks
    .map((t) => ({ id: t.id, name: t.name, sources: practiceFieldSourcesForTrack(t) }))
    .filter((t) => t.sources.length > 0);

  return (
    <Shell title="Lap time analysis" backHref="/tools">
      <LapAnalysisLibrary
        eventId={eventId}
        importSlot={
          <CompetitorPracticePull
            competitors={competitors}
            tracks={practiceTracks}
            todayYmd={calendarYmdInTimeZone(new Date(), user.timeZone?.trim() || "UTC")}
          />
        }
      />
    </Shell>
  );
}
