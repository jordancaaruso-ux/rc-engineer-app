import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CircleDot, FlaskConical } from "lucide-react";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { getCachedPaddockModel } from "@/lib/cachedReads";
import { CardPanel } from "@/components/ui/CardPanel";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { NextOutHero, NothingBookedHero } from "@/components/paddock/NextOutHero";
import { PaddockCars } from "@/components/paddock/PaddockCars";
import { PaddockTracks } from "@/components/paddock/PaddockTracks";
import { PaddockMeetings } from "@/components/paddock/PaddockMeetings";
import { PaddockConsumables } from "@/components/paddock/PaddockConsumables";
import { catalogHrefFromPaddock } from "@/lib/catalogReturn";

/**
 * Paddock — cars, setups, tracks and meetings, in the dock cell `More` used to hold.
 *
 * The rule this page is built on: **show the thing, don't name it.** `/more` was a table of
 * contents — three doors, each with a sentence explaining what was behind it — and that
 * sentence was the tell. It rendered identically for every driver on every day of the year,
 * which is what made it read as scaffolding rather than a place. Nothing on this page needs
 * a description, because everything on it is real: your cars, your tracks, your next meeting.
 *
 * Order is the argument. Folding events into a page about equipment risked burying the only
 * forward-looking surface in the app, so the next meeting goes first and counts down. Cars
 * follow because every run points at one. Tracks after that. Meetings-after-the-next sit last
 * because the band is empty most weeks.
 *
 * The bands lead to `/cars`, `/tracks` and `/events`, which are unchanged and still hold the
 * full lists, the filters and the editors. This is a summary, not a replacement.
 *
 * ── Plain lists, 2026-08-19 ──────────────────────────────────────────────────────────────────
 * Every ASSET band is now five names and a door. No counts, no dates, no second lines, no chips,
 * and no expanded first row — founder call, extending the pin that took the run count and the
 * date off the car card that morning. Each band component carries what it lost and why;
 * `paddockModel` carries the shapes and the row count, and `BandFoot` the door.
 *
 * The two cards that still hold figures are the hero and Events, deliberately: an event is a date
 * with a name on it, so "in 6 days" is not a statistic about the row, it is the row. A countdown
 * with the days taken off it is not a countdown. That makes this page four plain lists plus one
 * card that counts down, which reads as deliberate because the countdown is the only
 * forward-looking thing on it.
 *
 * The objection, recorded because it is the real one: this page exists because `/more` was a table
 * of contents, the fix was "show the thing, don't name it", and the counts were the SHOWING. Five
 * cards of names above five yellow buttons is closer to what was deleted than anything here has
 * been. It survives on one distinction — `/more` named categories that rendered identically for
 * every driver on every day of the year, and "A800RR, Xray X4, Mugen MTC3" is this driver's
 * garage and nobody else's. Thinner, but content rather than scaffolding. What genuinely went is
 * the question a name cannot answer: is this car in service, is this the staple compound or the
 * one I tried once. Those live behind the doors now, which is fine while Paddock is a way in and
 * wrong the moment anyone reads it to decide something.
 */
export const metadata: Metadata = {
  title: "Paddock",
};

export default async function PaddockPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header is-echo">
          <div className="min-w-0">
            <h1 className="page-title">Paddock</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-2xl" contentClassName="text-sm text-muted-foreground">
            Set DATABASE_URL in .env to load your cars, tracks and meetings.
          </CardPanel>
        </section>
      </>
    );
  }

  const [user, timeZone] = await Promise.all([
    requireCurrentUser(),
    getExplicitTimeZoneForRunFormatting(),
  ]);
  const model = await getCachedPaddockModel({ id: user.id, email: user.email }, timeZone);

  const hasCars = model.cars.length > 0;

  return (
    <>
      <header className="page-header is-echo">
        <div className="min-w-0">
          <h1 className="page-title">Paddock</h1>
          <p className="page-subtitle">Your cars, your tracks, and what&apos;s next.</p>
        </div>
      </header>

      {/*
        `max-w-4xl` only governs the tablet band now. From 1024px `.page-body` takes the
        app-wide 1760px measure (globals.css, 2026-08-29) and wins outright — it is unlayered
        CSS and this is a Tailwind utility — so the page runs the full width like the dashboard.
        The class stays because between 768 and 1023px it is still the clamp, and it stays on
        `.page-body` rather than an inner div: `.page-body` carries `margin-inline: auto`, so a
        clamped column only CENTRES when the max-width is on it. An inner clamp is how the first
        build ended up with 1024px of content jammed against the left edge of a 1440px window.
      */}
      <section className="page-body max-w-4xl">
        {/*
          One column on the phone — the reference layout — and two from `lg`, where the hero
          spans both so the countdown keeps the full width it earns. Desktop lives entirely
          behind `lg:`; no base class here is a desktop decision.

          The split survived the fold unchanged, against expectation. Cars alone on the left made
          sense when that band was uncapped — five full cards ran to roughly twice the height of
          Tracks and Events together — and the plan was to move Events across to even it up once
          all three were short. Folded, the columns land at about 350px and 470px; moving Events
          would make that 540 and 280, which is worse. Left as is.

          Plain lists shorten both columns by roughly the same amount — every band lost its tall
          first row and gained two one-line ones — so the balance is where it was and this stays a
          decision nobody needs to revisit. Measure before moving anything: the argument above is
          about the RATIO, and both numbers moved.
        */}
        <div className="lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start lg:gap-x-5">
          <div className="lg:col-span-2">
            {/*
              A brand-new account gets no hero at all. A countdown to nothing is worse than no
              countdown, and the only useful thing to say to someone with no car is which one
              thing to do first — everything else on this page hangs off it.
            */}
            {hasCars ? (
              model.nextUp ? (
                <NextOutHero nextUp={model.nextUp} />
              ) : (
                <NothingBookedHero lastOuting={model.lastOuting} />
              )
            ) : (
              <CardPanel contentClassName="space-y-3">
                <div>
                  <p className="hub-row-title">Start with the car</p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                    Everything here hangs off it — your setups, the tracks you take it to, and
                    the meetings you enter. It takes about a minute.
                  </p>
                </div>
                <ButtonLink href="/cars">Add your car</ButtonLink>
              </CardPanel>
            )}
          </div>

          {/*
            The band headings are INSIDE their cards now (founder pin, 2026-08-19) — each band
            component renders its own `BandHeader` as the card's top row. What used to live here
            was the label and its `+` floating in the gutter above the card, and the `mt-5` those
            rows carried is the only thing this page still owes them: the gap between the hero and
            the bands. The wide column's `<div>` stays even when the cars band renders null — a
            brand-new account has no cars — because Events is what holds that column open now.
          */}
          {/*
            Band order is a straight ranking, given as one (founder call, 2026-08-29): events,
            cars, tracks, tyres, additives. Events used to sit LAST, on the argument that the band
            is empty most weeks; the ranking overrides that — a meeting you have entered outranks
            a cupboard you might restock, and the hero directly above is about the same weekend.

            The DOM order IS the phone order (one column below `lg`), so the ranking has to read
            straight down these two divs: everything before the split lands in the WIDE left
            column, everything after it in the narrow right one. The split stays where it was —
            two bands left, three right — so each band simply moves down one slot and the columns
            keep roughly the heights they had. Measure before moving anything else.
          */}
          <div className="mt-5 space-y-5">
            <PaddockMeetings meetings={model.upcoming} total={model.meetingTotal} />
            {hasCars ? <PaddockCars cars={model.cars} total={model.carTotal} /> : null}
          </div>

          <div className="mt-5 space-y-5">
            <PaddockTracks tracks={model.tracks} catalogCount={model.trackCatalogCount} />
            <PaddockConsumables
              label="Tyres"
              items={model.tires}
              href={catalogHrefFromPaddock("/tires")}
              icon={CircleDot}
              addLabel="Add a tyre"
              doorTitle="The tyre catalog"
              doorDetail="Every compound, shared across the app"
              /* The count only when there is something hidden, matching the other three doors:
                 "Browse all 2 tyres" is a button that promises a room and opens a cupboard. */
              doorAction={
                model.tireCatalogCount > model.tires.length
                  ? `Browse all ${model.tireCatalogCount} tyres`
                  : "Browse the catalog"
              }
            />
            <PaddockConsumables
              /* Plural, like every other band on the page and like the page it opens. The pin
                 said "additive" — that was the subject, not the label; the card lists several. */
              label="Additives"
              items={model.additives}
              href={catalogHrefFromPaddock("/additives")}
              icon={FlaskConical}
              addLabel="Add an additive"
              doorTitle="The additive catalog"
              doorDetail="Every product, shared across the app"
              doorAction={
                model.additiveCatalogCount > model.additives.length
                  ? `Browse all ${model.additiveCatalogCount} additives`
                  : "Browse the catalog"
              }
            />
          </div>
        </div>
      </section>
    </>
  );
}
