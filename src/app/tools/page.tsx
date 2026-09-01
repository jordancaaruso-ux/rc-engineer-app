import type { Metadata } from "next";
import type { ReactNode } from "react";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { getCachedToolsModel } from "@/lib/cachedReads";
import { CardPanel } from "@/components/ui/CardPanel";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { GeometryBench } from "@/components/tools/GeometryBench";
import { VideoBench } from "@/components/tools/VideoBench";
import { LapImportBench } from "@/components/tools/LapImportBench";

/**
 * Tools — the benches, in the dock cell the 2026-08-18 restructure freed and then spent on padding.
 *
 * Paddock collapsed Garage, Events and `More` into one page, which was supposed to buy Tools a
 * cell of its own. The first build put the saving into wider cells instead and left Tools folded
 * into Analysis on the phone — two links at the foot of the debrief, with code lighting the
 * Analysis cell while you stood inside the Geometry Lab. This page is the other half of that job
 * (founder call 2026-08-19).
 *
 * It is built on the rule Paddock established: **show the thing, don't name it.** The old `/tools`
 * was three rows with a sentence under each explaining what was behind it — the same shape as
 * `/more`, and the sentence was the tell, because it read identically for every driver on every
 * day of the year. Promoting that into the dock would have recreated the problem the restructure
 * had just solved, with a better word on it. So every band here is seeded from this account: the
 * car's own roll centres, this driver's video jobs.
 *
 * Order is the argument. Geometry leads because it is the one band that answers its question
 * without opening anything. Video follows, because a queue you are waiting on is worth a glance.
 *
 * It carried two more for one day — Compare and Lap import — and both came off on 2026-08-19 by
 * founder call. Lap import came BACK on 2026-08-27 as Laptime Analysis, because what it leads to
 * changed: it was a tray of imports waiting to be filed onto a run, and it is now the door to
 * reading any timing sheet, including one from a race nobody here entered. Compare is still
 * unwired (`src/components/tools/CompareBench.tsx`), and `loadToolsModel` still builds the
 * `compare` model nothing reads, so putting it back is an import and a line of JSX.
 *
 * The bands lead to the Lab, `/videos` and `/laps/analysis`, unchanged behind them. This is a
 * summary, not a replacement.
 */
export const metadata: Metadata = {
  title: "Tools",
};

export default async function ToolsPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header is-echo">
          <div className="min-w-0">
            <h1 className="page-title">Tools</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-2xl" contentClassName="text-sm text-muted-foreground">
            Set DATABASE_URL in .env to load your car and your video.
          </CardPanel>
        </section>
      </>
    );
  }

  const [user, timeZone] = await Promise.all([
    requireCurrentUser(),
    getExplicitTimeZoneForRunFormatting(),
  ]);
  const model = await getCachedToolsModel(user.id, timeZone);

  return (
    <>
      <header className="page-header is-echo">
        <div className="min-w-0">
          <h1 className="page-title">Tools</h1>
          <p className="page-subtitle">The benches, set up with your own car.</p>
        </div>
      </header>

      {/*
        The clamp goes on `.page-body`, not on an inner div — `.page-body` carries
        `margin-inline: auto`, so the column only centres when the max-width is on IT, and
        `.page-header` mirrors the clamp off its next sibling to keep the title on the same
        axis as the cards at xl+.

        `max-w-4xl` below xl matches Paddock, the other dock neighbour. From xl `tools-wide`
        lifts the cap to the dashboard's and the lap sheet's 1760px axis (founder call,
        2026-08-27: the same width as the dashboard and Laptime Analysis). It has to be plain
        CSS in globals.css, not an `xl:max-w-*` utility, for the `@layer` reason `.dash-wide`
        documents there.
      */}
      <section className="page-body tools-wide max-w-4xl">
        {/*
          One column on a phone, three across from xl (founder call, 2026-08-27).

          It had been one column at every width since the page went to two bands: the geometry
          drawing spanned it and Video sat under it. With Laptime Analysis back that made three
          cards stacked in an 896px column on a 1440 monitor — you scrolled to reach the third,
          on a page whose whole point is that nothing needs opening. Three equal columns put
          every bench on the first screen, and the grid's default `items-stretch` keeps the
          three cards one height so no bench reads as the small one: each is `h-full`, its
          list grows, and its door is pinned to the foot.
        */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          {model.geometry ? (
            <GeometryBench geometry={model.geometry} />
          ) : (
            /*
              No car, or no run on one yet.

              Every band on this page is seeded from a logged run, so on a fresh account the
              page would otherwise be empty cards — which reads as broken rather than as new.
              One card says what fills them, and the Lab still opens, because it is the one
              bench that genuinely works with nothing.
            */
            <CardPanel className="h-full" contentClassName="space-y-3">
              <div>
                <p className="hub-row-title">The benches fill in from your runs</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  Log one and this page arrives set up — your car&apos;s own geometry, and any
                  video you send off for analysis.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ButtonLink href="/runs/new">Log a run</ButtonLink>
                <ButtonLink href="/analysis/roll-center" variant="outline">
                  Open the lab
                </ButtonLink>
              </div>
            </CardPanel>
          )}

          {/* Each band carries its own heading, as the top row of its own card
              (founder pin, 2026-08-19) — see `BandHeader`. */}
          <VideoBench jobs={model.video} />

          {/*
            Laptime Analysis, back on the page (founder call 2026-08-27) with a different job from the
            one it came off for. It was a filing tray — imports "waiting" to be attached to a
            run — and a filing tray earns no space. It is the front door to lap analysis now:
            these sessions OPEN, and reading one no longer requires having driven it.
          */}
          <LapImportBench sessions={model.unlinkedLaps} total={model.unlinkedLapTotal} />
        </div>
      </section>
    </>
  );
}
