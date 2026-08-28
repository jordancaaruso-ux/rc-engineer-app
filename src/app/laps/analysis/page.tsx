import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import {
  getKnownCompetitorsSetting,
  getLiveRcDriverNameSetting,
  getMyNameSetting,
} from "@/lib/appSettings";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { toCompareRunShape } from "@/lib/runCompareShape";
import { loadImportedSessionAnchor } from "@/lib/lapImport/importedSessionAnchor";
import { getSpeedhiveDriverNamesForUser } from "@/lib/speedhive/speedhiveDriverSettings";
import { LapAnalysisBoard } from "@/components/laps/LapAnalysisBoard";
import { LapAnalysisLibrary } from "@/components/laps/LapAnalysisLibrary";
import { CompetitorPracticePull } from "@/components/laps/CompetitorPracticePull";
import { parseKnownCompetitorsSetting } from "@/lib/speedhive/knownCompetitors";
import { PageBackLink } from "@/components/ui/PageBackLink";

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

function Shell({
  title,
  subtitle,
  backHref,
  wide = false,
  children,
}: {
  title: string;
  subtitle?: string | null;
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
          <h1 className="page-title max-w-full [overflow-wrap:anywhere]">{title}</h1>
        </div>
      </header>
      <section className={wide ? "page-body laps-wide" : "page-body max-w-6xl"}>
        {/*
         * A `subtitle` here is only ever page-level copy that carries no times — the
         * SESSION's context line (track · when · drivers · source) is rendered inside
         * `LapAnalysisBoard` instead, so its clock is the browser's and matches the grid's.
         * It cannot live under the title either way: `.page-header .page-subtitle` is
         * `display: none` app-wide.
         */}
        {subtitle ? (
          <p className="ui-caption mb-3 text-muted-foreground">{subtitle}</p>
        ) : null}
        {children}
      </section>
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
     * who happened to fetch it.
     */
    const [speedhiveNames, liveRcName] = await Promise.all([
      getSpeedhiveDriverNamesForUser(user.id),
      getLiveRcDriverNameSetting(user.id),
    ]);
    const myName = await getMyNameSetting(user.id);
    const viewerNames = [...speedhiveNames, liveRcName ?? "", myName ?? ""].filter(Boolean);

    const anchor = await loadImportedSessionAnchor(user.id, sessionId, { viewerNames });
    if (!anchor) notFound();

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
      <Shell title={anchor.title} backHref="/laps/analysis" wide>
        <LapAnalysisBoard
          run={anchor.run}
          otherRuns={myRuns.map(toCompareRunShape)}
          runListSource="my_runs"
          primaryDriverName={anchor.anchorDriverName}
          primaryIsViewer={anchor.anchorIsViewer}
          initialTargetId={initialTargetId}
          initialComparisonIds={initialComparisonIds ?? wholeField}
          trackName={anchor.trackName}
          whenIso={anchor.whenIso}
          driverCount={anchor.driverCount}
          sourceLabel={anchor.sourceLabel}
        />
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
   * The pull card's two ingredients. Tracks are cut to the ones with a MYLAPS practice page,
   * because those are the only ones a chip can be looked up in — offering the rest would be
   * offering a button that cannot work.
   */
  const [competitors, speedhiveTracks, librarySpeedhiveNames, libraryLiveRcName, libraryMyName] =
    await Promise.all([
      getKnownCompetitorsSetting(user.id).then(parseKnownCompetitorsSetting),
      prisma.track.findMany({
        where: { speedhiveUrl: { not: null } },
        orderBy: { name: "asc" },
        take: 300,
        select: { id: true, name: true },
      }),
      getSpeedhiveDriverNamesForUser(user.id),
      getLiveRcDriverNameSetting(user.id),
      getMyNameSetting(user.id),
    ]);

  /** Same set the session view matches on — see `sessionHasDriver` in the library. */
  const libraryViewerNames = [
    ...librarySpeedhiveNames,
    libraryLiveRcName ?? "",
    libraryMyName ?? "",
  ].filter(Boolean);

  return (
    <Shell
      title="Lap time analysis"
      subtitle="Read any timing sheet — a race you drove, a teammate's practice, a meeting on the other side of the world."
      backHref="/tools"
    >
      <div className="space-y-4">
        <LapAnalysisLibrary eventId={eventId} viewerNames={libraryViewerNames} />
        <CompetitorPracticePull competitors={competitors} tracks={speedhiveTracks} />
      </div>
    </Shell>
  );
}
