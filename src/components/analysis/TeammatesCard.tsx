import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { OutWithYouModel, TeammatesModel } from "@/lib/analysis/analysisHomeModel";
import { formatSignedDeltaSec } from "@/lib/videoAnalysis/lapCompare";
import { TeammatesLastOutList } from "@/components/analysis/TeammatesLastOutList";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

/**
 * Teammates — two halves, two scopes, one card.
 *
 * **Top: the meeting.** The other drivers at your most recent shared meeting, or at your track
 * that day, and the best lap of their most recent run there. Sorted by pace, windowed around you.
 *
 * **Bottom: Last out.** Every teammate you have, wherever they were, ordered by how recently they
 * last ran. Added 2026-08-20 on founder instruction — *"the list below should be expansive, every
 * teammate you have"* — and it is what finally makes the card's title literally true.
 *
 * ── The two scopes do not match, and must not be reconciled ──────────────────────────────────
 * The top half is **co-presence**: nothing behind it reads `TeamMembership`, so a stranger at the
 * same club round is a row and a teammate who stayed home is not. Teams were put up as the
 * denominator for that half on 2026-08-19 and rejected, twice, for exactly that reason. The
 * bottom half is **membership** and nothing else. Those are genuinely different questions —
 * *how am I going against the people here* and *who on my team has been out* — and the card
 * answers them one above the other rather than blending them into a list that answers neither.
 *
 * That is also why the file and model keep the `OutWithYou` name for the top half only: it
 * describes what that query does, and renaming it to `Teammates` would make the code assert a
 * scope it does not have.
 *
 * The live consequence is in `NewRunForm`'s share-toggle copy, which spends "Teammates" on real
 * team members — *"Teammates see the run and its setup. Drivers who were out with you see your
 * best lap."* Those are two different audiences with two different exposures. That sentence is
 * still accurate and still worth keeping accurate; it now maps onto the two halves of this card.
 *
 * ── Why it reads the way it does ─────────────────────────────────────────────────────────────
 * **You are in the middle, not at the top.** The meeting rows are sorted by lap time and windowed
 * around the viewer (`windowAroundViewer`), because a list you always lead — or always trail — is
 * a list you stop reading, and the two drivers either side of you are the ones you are racing.
 * The cost is that the meeting's fastest driver is often off the card entirely; the Last-out band
 * is the first place the wider group appears, which is part of why it earns its space.
 *
 * **A door only where you already have the key.** The top half was link-free until 2026-08-20, on
 * the grounds that its exposure is one number and a name, so a row opening anything would promise
 * access the model does not grant. That reasoning survives; it just has an exception. A driver you
 * share a TEAM with is someone whose runs you can already read, so their row opens Sessions in
 * that team's scope narrowed to them — a shortcut to a page that was always theirs to open, not a
 * new grant. Rows without a shared team stay readouts, and the chevron is the tell. In the
 * Last-out band **every** row is a door, because every row is by definition a teammate.
 *
 * **The footer admits the gap.** The meeting half can only show people who use the app: eighteen
 * entrants at a club round might be two rows. Stating the count is what stops it reading as a
 * results board that has mislaid fifteen drivers.
 *
 * Neither half has an empty state. When both are empty the model is null and the page drops the
 * card — a box explaining that nobody else here logs runs is a card about the app's adoption
 * rather than about the driving.
 */
export function TeammatesCard({ model }: { model: TeammatesModel }) {
  const { meeting, lastOut } = model;

  return (
    <CardPanel contentClassName="flex flex-col gap-1 p-4">
      {/*
        Stacked on a phone, one row from `sm`. Side by side at 390px the eyebrow wrapped to two
        lines AND the scope still truncated mid-date ("Ironbark Raceway · 19 Aug 2…") — two labels
        both losing, which is what a row that cannot fit looks like. `whitespace-nowrap` on the
        eyebrow is what makes the one-row version safe: the scope is the half that may truncate.
      */}
      <div className="flex min-w-0 flex-col gap-0.5 pb-1.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <Eyebrow dot="muted" className="mb-0 whitespace-nowrap">
          Teammates
        </Eyebrow>
        {/* The scope, and it is load-bearing rather than decorative: a meeting name means everyone
            here entered the same event, while a track and a date means only that you were both at
            that venue that day, which is a weaker claim and has to look like one. It belongs to
            the TOP half only — with no meeting to show, there is no scope to state. */}
        {meeting ? (
          <span className="type-timestamp min-w-0 truncate sm:text-right">
            {meeting.scopeLabel}
          </span>
        ) : null}
      </div>

      {meeting ? <MeetingHalf meeting={meeting} /> : null}

      {lastOut.length > 0 ? (
        <>
          {/* The band's own header, because the two halves are different questions and a reader
              who scrolls into the second one without a label would read it as more of the first.
              The right-hand note names the scope change — this band is every track, not this one. */}
          <div
            className={cn(
              "flex items-baseline justify-between gap-3",
              meeting && "mt-3 border-t border-border pt-3"
            )}
          >
            <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-foreground">
              Last out
            </span>
            <span className="type-timestamp truncate text-faint">any track · newest first</span>
          </div>

          <TeammatesLastOutList rows={lastOut} />
        </>
      ) : null}
    </CardPanel>
  );
}

/** The pace comparison: everyone at that meeting, sorted by lap time, windowed around you. */
function MeetingHalf({ meeting }: { meeting: OutWithYouModel }) {
  return (
    <>
      <div className="flex flex-col">
        {meeting.drivers.map((driver, index) => {
          const body = (
            <>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[13.5px] tracking-tight",
                  driver.isViewer
                    ? "font-semibold text-foreground"
                    : "font-medium text-muted-foreground",
                  // A row you can open reads as openable: full ink on the name, the way every
                  // other tappable row in the app names its subject.
                  // `group/row`, not a bare `group` — `SurfaceCard` puts a plain `group` on the
                  // card, so an unnamed group-hover here fired on hovering ANYWHERE in the card and
                  // lit every linked name at once. See `TeammatesLastOutList`.
                  driver.sharedTeamId && "text-foreground group-hover/row:text-primary-ink"
                )}
              >
                {driver.name}
              </span>

              <span
                className={cn(
                  "shrink-0 tabular-nums leading-none",
                  driver.isViewer
                    ? "text-[17px] text-foreground"
                    : "text-[15px] text-muted-foreground"
                )}
              >
                {driver.bestLapSeconds.toFixed(3)}
              </span>

              {/* `theirs − yours`, so a negative number is someone quicker than you. Green and red
                  are allowed here because this is a pace delta, which is the one thing they mean.
                  There is no equivalent column in the Last-out band below, on purpose: those laps
                  come from different tracks, so a delta there would be arithmetic on nothing. */}
              <span
                className={cn(
                  "w-[4.25rem] shrink-0 text-right text-[12px] font-medium tabular-nums",
                  driver.deltaSeconds == null
                    ? "text-faint"
                    : driver.deltaSeconds < 0
                      ? "text-gain"
                      : "text-destructive"
                )}
              >
                {driver.deltaSeconds == null ? "—" : formatSignedDeltaSec(driver.deltaSeconds)}
              </span>

              {/* Holds the chevron's width on every row, drawn or not, so the lap times and deltas
                  stay in one column down the card. A list whose numbers step sideways depending on
                  who happens to be on your team is unreadable as a comparison, which is all this
                  half is. */}
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
            // The viewer's row is the anchor every other number is measured from, so it carries
            // full ink while the rest sit back a step.
            driver.isViewer && "-mx-1.5 rounded-lg bg-muted/50 px-1.5"
          );

          /*
           * Only a driver you share a team with gets a door, and it opens the page that was
           * already theirs to open: Sessions in that team's scope, narrowed to that driver
           * (`?teamId=…&driverIds=…`). Everyone else stays a readout.
           *
           * That split is the whole design of THIS half. Its scope is who was at the track —
           * which includes strangers — so linking every row would offer a run history the viewer
           * has no right to and land them on an access-denied page from a row that looked like a
           * door. `/runs/history` intersects `driverIds` with the real roster and re-checks
           * membership server-side, so a hand-typed URL gains nothing; this only decides what to
           * DRAW.
           *
           * `viewAll` is not in the query on purpose — the page treats any active filter as a
           * view-all request, and passing it as well would leave a redundant param in the URL the
           * driver sees and shares.
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
        "Best lap of their last run here" rather than the old "their most recent run" — the band
        below is now literally a list of most-recent runs, and two lines using that phrase for two
        different things is how a card stops being readable.
      */}
      <p className="type-timestamp pt-2">
        best lap of their last run here · {meeting.driverCount}{" "}
        {meeting.driverCount === 1 ? "driver" : "drivers"} logging
        {meeting.driverCount > meeting.drivers.length ? " (nearest shown)" : ""}
      </p>
    </>
  );
}
