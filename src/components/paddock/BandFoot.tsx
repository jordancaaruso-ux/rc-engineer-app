import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";

/**
 * The door at the foot of every Paddock band.
 *
 * Lifted wholesale from the Recent-runs card on `/analysis` (`RecentRunsCard`), which is what
 * the founder pointed at: "a thing at the bottom 'view all cars' like in analysis on the session
 * card". Two parts, and the split is the point — the paper row EXPLAINS what is through the door,
 * the yellow button ACTS and carries the count. Putting the count on the button leaves the sub-line
 * free to say what the room contains instead of repeating the number.
 *
 * All three bands get the button (founder call 2026-08-19). `BandHeader` (now `components/ui/`)
 * carries the opposite warning from the `+` pass — "three bands plus the log-run circle put five
 * yellow objects on one 390px screen, which turns the accent into wallpaper" — and it was put to
 * him with both drawn. He wants the buttons. If it reads loud in the hand the retreat is to drop
 * Tracks and Events to the row alone, which is deleting the `<span>` below, not a redesign.
 *
 * A `<span>`, never a nested `<button>` or `<a>`: the whole foot is already the link, and the tap
 * target has to be the whole foot — the button alone is ~40px, which is under the minimum on its
 * own. The three bands share this ONE component rather than each growing a copy, because three
 * feet that must look identical are exactly the thing that stops looking identical.
 *
 * Plain `bg-primary` with no face class: `.primary-face`'s lift is drawn for a button raised off
 * the page, and under something this wide the same shadow reads as a rule ruled across the card
 * rather than as depth. A yellow band on a pale card is already its own edge.
 */
export function BandFoot({
  href,
  icon: Icon,
  title,
  detail,
  action,
}: {
  href: string;
  icon: LucideIcon;
  /** What is through the door — "All your cars". */
  title: string;
  /** What the room contains. Never the count; that rides the button. */
  detail: string;
  /** The button's words, carrying the count — "View all 5 cars". */
  action: string;
}) {
  return (
    <Link
      href={href}
      prefetch
      className="tap-active group block border-t border-border px-4 pb-3.5 pt-3 transition-colors hover:bg-primary/[0.05]"
    >
      <span className="flex items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-primary-ink/35 bg-primary/[0.09] text-primary-ink">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-bold leading-tight tracking-tight text-foreground">
            {title}
          </span>
          <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
            {detail}
          </span>
        </span>
      </span>

      <span className="mt-2.5 flex items-center justify-center gap-1.5 rounded-[10px] bg-primary px-3 py-2.5 text-[13px] font-semibold tracking-tight text-primary-foreground transition group-hover:brightness-105 group-active:brightness-95">
        {action}
        <ChevronRight
          className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </span>
    </Link>
  );
}
