import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";

/**
 * The door at the foot of every Paddock band.
 *
 * Lifted wholesale from the Recent-runs card on `/analysis` (`RecentRunsCard`), which is what
 * the founder pointed at: "a thing at the bottom 'view all cars' like in analysis on the session
 * card". Two parts, and the split is the point — the paper row EXPLAINS what is through the door,
 * the button ACTS and carries the count. Putting the count on the button leaves the sub-line free
 * to say what the room contains instead of repeating the number.
 *
 * Every band gets the button (founder call 2026-08-19), and since 2026-09-25 it is GREY — the
 * Apple grey of `ButtonLink`'s `door` variant, drawn at band width. The warning `BandHeader`
 * (now `components/ui/`) carried from the `+` pass came true: yellow feet on every band plus the
 * log-run circle turned the accent into wallpaper, and the founder picked grey doors off a bench
 * of the real Paddock ("much more premium"). Yellow is for doing something; this goes somewhere.
 *
 * A `<span>`, never a nested `<button>` or `<a>`: the whole foot is already the link, and the tap
 * target has to be the whole foot — the button alone is ~40px, which is under the minimum on its
 * own. The three bands share this ONE component rather than each growing a copy, because three
 * feet that must look identical are exactly the thing that stops looking identical.
 *
 * No shadow and no face class: a door sits in the card, not on it. 46px with 15px type are the
 * bench's numbers — the old 40px bar with 13px type read as a banner rather than a button.
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
      className="tap-active group block border-t border-border px-4 pb-3.5 pt-3 transition-colors hover:bg-muted/40"
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

      <span className="mt-2.5 flex min-h-[46px] items-center justify-center gap-1.5 rounded-xl bg-foreground/[0.055] px-3 text-[15px] font-semibold tracking-[-0.01em] text-foreground transition group-hover:bg-foreground/[0.08] group-active:bg-foreground/[0.1]">
        {action}
        <ChevronRight
          className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </span>
    </Link>
  );
}
