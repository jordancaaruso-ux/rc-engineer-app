import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { OutWithYouModel, TeammatesModel } from "@/lib/analysis/analysisHomeModel";
import { TeammatesLastOutList } from "@/components/analysis/TeammatesLastOutList";
import { CardPanel } from "@/components/ui/CardPanel";
import { cn } from "@/lib/utils";

/**
 * Who else is out — **two cards**, because they answer two different questions.
 *
 * **Out with you.** The other drivers at your most recent shared meeting, or at your track that
 * day, and the best lap of their most recent run there. Sorted by pace, windowed around you.
 *
 * **Your team.** Every teammate you have, wherever they were, ordered by how recently they last
 * ran. Added 2026-08-20 on founder instruction — *"the list below should be expansive, every
 * teammate you have."*
 *
 * ── Why two cards, and why neither is called "Teammates" (2026-08-26) ────────────────────────
 * This was one card with that title until today, and the founder's question about it was the
 * proof it had failed: *"what are the top 2 drivers compared to the bottom list?"* Three things
 * were doing that damage at once — the title was true of the lower half only, so the upper rows
 * arrived pre-labelled as teammates when most of them are strangers; only the lower band carried
 * a heading, so the upper one read as "the card" and the lower as a footnote to it; and the line
 * saying what the figures were sat *underneath* them in 11px grey.
 *
 * Two cards fix all three by construction. The page is a stack of cards that each do one job —
 * the pace card and the runs card above went the same way an hour earlier — and a card can no
 * longer change subject halfway down, because it ends first.
 *
 * ── The two scopes do not match, and must not be reconciled ──────────────────────────────────
 * The standing is **co-presence**: nothing behind it reads `TeamMembership`, so a stranger at the
 * same club round is a row and a teammate who stayed home is not. Teams were put up as the
 * denominator for it on 2026-08-19 and rejected, twice, for exactly that reason. The roster is
 * **membership** and nothing else. Those are genuinely different questions — *how am I going
 * against the people here* and *who on my team has been out* — and each now has its own box.
 *
 * That is also why the model keeps the `OutWithYou` name for the standing only: it describes what
 * that query does, and renaming it `Teammates` would make the code assert a scope it lacks.
 *
 * The live consequence is in `NewRunForm`'s share-toggle copy, which spends "Teammates" on real
 * team members — *"Teammates see the run and its setup. Drivers who were out with you see your
 * best lap."* Two audiences, two exposures; they now map onto two cards.
 *
 * ── Why the standing reads the way it does ───────────────────────────────────────────────────
 * **You are in the middle, not at the top.** Rows are sorted by lap time and windowed around the
 * viewer (`windowAroundViewer`), because a list you always lead — or always trail — is a list you
 * stop reading, and the two drivers either side of you are the ones you are racing. The cost is
 * that the meeting's fastest driver is often off the card; the count under the rows is what stops
 * that reading as a results board that has mislaid people.
 *
 * **A door only where you already have the key.** A driver you share a team with is someone whose
 * runs you can already read, so their row opens Sessions in that team's scope narrowed to them —
 * a shortcut to a page that was always theirs to open, not a new grant. Rows without a shared team
 * stay readouts, and the chevron is the tell. In the roster **every** row is a door, because every
 * row is by definition a teammate.
 *
 * Neither card has an empty state. When both are empty the model is null and the page drops them —
 * a box explaining that nobody else here logs runs is a card about the app's adoption rather than
 * about the driving.
 */
export function TeammatesCard({ model }: { model: TeammatesModel }) {
  const { meeting, lastOut } = model;

  return (
    <div className="flex flex-col gap-3">
      {meeting ? <StandingCard meeting={meeting} /> : null}
      {lastOut.length > 0 ? (
        <CardPanel contentClassName="flex flex-col gap-0 p-0">
          <CardHead title="Your team" scope="any track · newest first" />
          <TeammatesLastOutList rows={lastOut} />
        </CardPanel>
      ) : null}
    </div>
  );
}

/**
 * The heading both cards wear: name left, scope right, hairline under.
 *
 * Composed by hand rather than through `<Eyebrow>` so the scope can ride the label's row — the
 * same shape `OutingHeading` uses at the top of this page, deliberately, so the four cards on
 * `/analysis` head themselves identically.
 */
function CardHead({ title, scope }: { title: string; scope: string }) {
  return (
    <div className="eyebrow-root mx-4 mb-1 mt-3 flex items-baseline gap-2">
      <h2 className="eyebrow-label min-w-0">
        <span className="min-w-0 truncate">{title}</span>
      </h2>
      <span className="ml-auto min-w-0 truncate text-[11.5px] text-muted-foreground">{scope}</span>
    </div>
  );
}

/**
 * The pace standing: everyone at that meeting, quickest first, windowed around you.
 *
 * ## The bar is the GAP, never the lap time
 *
 * A bar drawn from zero to a lap time is four identical blocks — the spread across a field is a
 * few per cent of the number. What a driver reads is the gap, so that is what is drawn: each row's
 * fill is its distance behind the quickest driver ON THE CARD, scaled to the slowest one on it.
 * The quickest row is therefore empty, which is the honest picture of a zero gap.
 *
 * Scaled to the slowest **shown**, not to the field: the list is windowed around the viewer, so a
 * driver five seconds off who never made the card cannot flatten everyone else's bars to nothing.
 *
 * One neutral ink, at two strengths — yours full, everyone else's at 22%. No green, no red: this
 * card spends those on nothing at all now, and the ± column they used to tint came off with the
 * standing treatment (founder call, 2026-08-26). The bar answers "how far behind" at a glance and
 * the lap times answer it exactly.
 */
function StandingCard({ meeting }: { meeting: OutWithYouModel }) {
  const laps = meeting.drivers.map((driver) => driver.bestLapSeconds);
  const fastest = Math.min(...laps);
  const spread = Math.max(...laps) - fastest;

  return (
    <CardPanel contentClassName="flex flex-col gap-0 p-0">
      <CardHead title="Out with you" scope={meeting.scopeLabel} />

      <div className="flex flex-col px-4 pt-1">
        {meeting.drivers.map((driver, index) => {
          const gap = driver.bestLapSeconds - fastest;
          // A hairline of fill on a real-but-tiny gap, so "just behind" and "level" stay
          // different pictures. Zero stays zero.
          const pct = spread > 0 ? Math.max((gap / spread) * 100, gap > 0 ? 3 : 0) : 0;
          const body = (
            <>
              <span
                className={cn(
                  "w-[86px] shrink-0 truncate text-[13px] tracking-tight",
                  driver.isViewer
                    ? "font-bold text-foreground"
                    : "font-medium text-muted-foreground",
                  // A row you can open reads as openable: full ink on the name, the way every
                  // other tappable row in the app names its subject. `group/row`, not a bare
                  // `group` — `SurfaceCard` puts a plain `group` on the card, so an unnamed
                  // group-hover fires on hovering ANYWHERE in the card.
                  driver.sharedTeamId && "text-foreground group-hover/row:text-primary-ink"
                )}
              >
                {driver.name}
              </span>

              {/*
                No track behind the fill. It shipped for one build with a 6% ink groove and the
                quickest driver — whose gap is zero, so whose fill is nothing — read as having a
                bar of his own, the same length as the driver a second behind him and only a shade
                lighter. Two bars of equal length meaning opposite things is worse than no picture
                at all. Drawn on bare card, a long bar is a long way back and a stub is level.
              */}
              <span className="relative h-2 min-w-0 flex-1">
                <span
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-full",
                    driver.isViewer ? "bg-foreground" : "bg-elevate/[0.22]"
                  )}
                  // The stub. A zero gap still gets a mark, or the quickest row reads as a
                  // rendering fault rather than as the fastest lap on the card.
                  style={{ width: `max(6px, ${pct}%)` }}
                  aria-hidden
                />
              </span>

              <span
                className={cn(
                  "w-[52px] shrink-0 text-right tabular-nums leading-none",
                  driver.isViewer
                    ? "text-[15px] font-semibold text-foreground"
                    : "text-[13.5px] text-muted-foreground"
                )}
              >
                {driver.bestLapSeconds.toFixed(3)}
              </span>

              {/* Holds the chevron's width on every row, drawn or not, so the lap times stay in
                  one column down the card. A list whose numbers step sideways depending on who
                  happens to be on your team is unreadable as a comparison, which is all this is. */}
              <span className="w-4 shrink-0" aria-hidden>
                {driver.sharedTeamId ? (
                  <ChevronRight className="h-4 w-4 text-faint transition-transform group-hover/row:translate-x-0.5 group-hover/row:text-muted-foreground" />
                ) : null}
              </span>
            </>
          );

          const rowClass = cn(
            "flex items-center gap-3 py-2.5",
            index > 0 && "border-t border-border",
            // The viewer's row is the anchor every other number is read against, so it carries
            // full ink while the rest sit back a step.
            driver.isViewer && "-mx-1.5 rounded-lg bg-muted/50 px-1.5"
          );

          /*
           * Only a driver you share a team with gets a door, and it opens the page that was
           * already theirs to open: Sessions in that team's scope, narrowed to that driver.
           * Everyone else stays a readout — this card's scope is who was at the track, which
           * includes strangers, so linking every row would offer a run history the viewer has no
           * right to and land them on an access-denied page from a row that looked like a door.
           * `/runs/history` re-checks membership server-side; this only decides what to DRAW.
           */
          return driver.sharedTeamId ? (
            <Link
              key={driver.userId}
              href={`/runs/history?teamId=${encodeURIComponent(
                driver.sharedTeamId
              )}&driverIds=${encodeURIComponent(driver.userId)}`}
              prefetch={false}
              aria-label={`${driver.name}'s sessions`}
              className={cn(
                rowClass,
                "tap-active group/row -mx-1.5 rounded-lg px-1.5 transition-colors hover:bg-elevate/[0.035]"
              )}
            >
              {body}
            </Link>
          ) : (
            <div key={driver.userId} className={rowClass}>
              {body}
            </div>
          );
        })}
      </div>

      {/*
        The count, and only the count (2026-08-26). The line under these rows used to explain what
        the figures were — "best lap of their last run here · 2 drivers logging" — and the founder
        cut the explaining half: the column is lap times under a heading that says who they belong
        to, and a card that has to caption its own numbers has not made them clear.

        What survives is the admission. This card can only show people who use the app: eighteen
        entrants at a club round might be two rows, and stating that is what stops it reading as a
        results board that has mislaid sixteen drivers.
      */}
      <p className="type-timestamp px-4 pb-3 pt-2">
        {meeting.driverCount > meeting.drivers.length
          ? `nearest ${meeting.drivers.length} of ${meeting.driverCount} logging runs here`
          : `${meeting.driverCount} ${meeting.driverCount === 1 ? "driver" : "drivers"} logging runs here`}
      </p>
    </CardPanel>
  );
}
