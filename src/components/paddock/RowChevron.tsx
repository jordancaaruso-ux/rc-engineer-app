import { ChevronRight } from "lucide-react";

/**
 * The "this opens" mark on a Paddock row.
 *
 * Founder pin, 2026-08-19: "this page items need a chevron on the right or something so they
 * look clickable, right now its just like listings." Every line on `/paddock` already WAS a
 * link — each car, each track, each event — and the only thing saying so was a hover tint. There
 * is no hover on a phone, so on the surface the page was designed for, five cards of live doors
 * read as a table you happen to be able to press.
 *
 * ── One mark, since the plain-lists pass ─────────────────────────────────────────────────────
 * It was ranked — `lead` > `row` > `child`, in size and in ink — and the rank is gone with the two
 * kinds of row it was ranking. `child` marked the setups nested under a car and was one of four
 * signals keeping a setup row from reading as another car; those rows have left the page. `lead`
 * was the expanded item's mark, positioned rather than flowed, because an arrow set beside the top
 * line of a three-line block reads as pointing at the timestamp next to it rather than at the
 * item; there is no expanded item and no timestamp any more. If either mark is ever needed again,
 * the trap the old one recorded was that `lead` only lands on the same right-hand rail as the rows
 * below it with `relative` on its parent, `right-4` on itself and `pr-6` on the block it sits
 * against — without the padding a long name runs under the arrow.
 *
 * ── Where it sits ────────────────────────────────────────────────────────────────────────────
 * Hard right, and it is the only thing in that column now. It costs ~21px off the name at 390px,
 * which is why the mark is 14px and not the 20px an icon button would be.
 *
 * ── The one thing to hold ────────────────────────────────────────────────────────────────────
 * Five bands draw this and they must not drift. Cars, Tracks, Tyres, Additives and Events each
 * had their own copy of the row markup before this existed, which is the same trap `BandFoot`
 * and `BandHeader` were made single components for. Change the mark here or not at all.
 */
export function RowChevron() {
  return (
    <ChevronRight
      className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
      aria-hidden
    />
  );
}
