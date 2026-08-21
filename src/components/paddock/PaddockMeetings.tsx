import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { CardPanel } from "@/components/ui/CardPanel";
import { BandHeader } from "@/components/ui/BandHeader";
import { BandFoot } from "@/components/paddock/BandFoot";
import { RowChevron } from "@/components/paddock/RowChevron";
import {
  formatDaysUntil,
  type PaddockMeeting,
} from "@/lib/paddock/paddockModel";

/**
 * Meetings after the next one.
 *
 * The soonest meeting is already the hero, so this band is only what follows it — usually
 * nothing, sometimes one. That is why it sits below tracks rather than above: a band that is
 * empty most weeks should not be the second thing on the page.
 *
 * Past meetings are deliberately not here. They are a review surface and they belong to
 * Analysis; listing them again would put "how did that go" in two places and turn Paddock
 * into a second Sessions.
 *
 * ── The fold, 2026-08-19 ─────────────────────────────────────────────────────────────────────
 * Every band on this page now reads "one expanded, two compact, then a door", and this is the
 * band where that shape does not drop in cleanly: **the expanded one is already the hero at the
 * top of the page.** So the hero IS this band's expanded item, and the card below it holds only
 * the compact pair. Opening a second meeting under the first would put two countdown blocks in
 * a row — the same object, drawn twice, three inches apart.
 *
 * The rows lost their track sub-line to the fold and gained it back inline ("Club Day ·
 * Southside"), because a compact row is one line by definition and the venue is half of what
 * makes a meeting recognisable.
 *
 * The foot is new work rather than a restyle. The old one was a dead line of prose saying where
 * past meetings had gone; it named Analysis and opened nothing. This one opens the events page
 * and still says it.
 */
export function PaddockMeetings({
  meetings,
  total,
}: {
  meetings: PaddockMeeting[];
  /** Every booked meeting, the hero's included — the door's count. */
  total: number;
}) {
  return (
    <CardPanel contentClassName="p-0">
      <BandHeader label="Events" addHref="/events" addLabel="New event" />

      {meetings.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-muted-foreground">
          Nothing else booked.
        </p>
      ) : (
        meetings.map((meeting, index) => (
          <Link
            key={meeting.id}
            href={`/events/${encodeURIComponent(meeting.id)}`}
            className={`tap-active group flex items-center gap-3 px-4 py-3 transition hover:bg-muted/40 ${
              index > 0 ? "border-t border-border/60" : ""
            }`}
          >
            <span className="ui-title min-w-0 flex-1 truncate text-[13.5px] font-semibold text-foreground">
              {meeting.name}
              {meeting.trackName ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {meeting.trackName}
                </span>
              ) : null}
            </span>
            <span className="type-timestamp shrink-0">
              {formatDaysUntil(meeting.daysUntil)}
            </span>
            <RowChevron />
          </Link>
        ))
      )}

      <BandFoot
        href="/events"
        icon={CalendarDays}
        title="All your meetings"
        detail="Booked and entered · past ones in Analysis"
        /* `total` counts the hero's meeting too, so it is ahead of `meetings.length` whenever
           there is a hero at all — hence the second guard. One booked meeting means the hero is
           already showing it, and "View all 1 meetings" is both wrong and pointless. */
        action={
          total > meetings.length && total > 1
            ? `View all ${total} meetings`
            : "Open events"
        }
      />
    </CardPanel>
  );
}
