import type { ReactNode } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

/**
 * A band's signpost, with the one action that band supports — drawn as the top row OF the
 * band's card.
 *
 * Lived in `components/paddock/` until Tools grew bands of its own (2026-08-19). It is a layout
 * primitive, not a Paddock part — the two pages have to sit level with each other, and a second
 * copy is how two surfaces that must look identical stop looking identical.
 *
 * ── Inside the card, 2026-08-19 ──────────────────────────────────────────────────────────────
 * It used to float in the gap ABOVE its card ("Cars", then a card of cars). Founder call from a
 * `.markup` pin on `/paddock`: headings belong IN the card. A label sitting in the page gutter
 * belongs to the page; the same label on the card's own top row belongs to the card, and on a
 * phone — where the gutter is nothing but vertical space — the floating version read as an
 * orphaned word between two cards. So the band component renders this as its first child, inside
 * the card, above a full-bleed hairline.
 *
 * The `+` came inside with it, unchanged in every other respect. It still wears the dashed, quiet
 * face `CollapsibleAddRow` established — NOT the yellow primary. Yellow was the first draft and it
 * was wrong twice over: it is not what the rest of the app's add affordances look like, and three
 * bands plus the log-run circle put five yellow objects on one 390px screen, which turns the accent
 * into wallpaper. The circle is the loud one here; adding a track is not.
 *
 * `-my-1` on the button, not a shorter row: the 36px tap target is the minimum a thumb can find,
 * and letting it set the row height would make every band header 56px of chrome before a word of
 * content. The negative margin keeps the target and hands the row back to the label.
 *
 * It links to the band's full page rather than opening a form: adding a car, a track or a
 * meeting each has a real flow with validation and pickers, and a second inline copy of any
 * of them would drift.
 *
 * `aria-label` is explicit because the glyph is the whole control — "Add" alone would read
 * out three identical buttons to a screen reader.
 */
export function BandHeader({
  label,
  addHref,
  addLabel,
  action,
}: {
  label: string;
  addHref?: string;
  addLabel?: string;
  /**
   * A control of the band's own in place of the `+` link — for the one band whose action is not
   * "go to a page" (the video library's Upload is a file pick). Same row, same right-hand slot.
   */
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
      {/* The raw `.eyebrow-label` span, not the `Eyebrow` wrapper: that wrapper carries
          `.eyebrow-root` (its own bottom rule) plus `mb-2`, and both are the floating-in-the-gutter
          spacing this row replaces. The rule here is the card's, full-bleed to its edges. */}
      <span className="eyebrow-label min-w-0">{label}</span>
      {action ? (
        <span className="-my-1 flex shrink-0 items-center">{action}</span>
      ) : addHref ? (
        <Link
          href={addHref}
          aria-label={addLabel ?? `Add to ${label}`}
          title={addLabel ?? `Add to ${label}`}
          className="tap-active -my-1 grid size-9 shrink-0 place-items-center rounded-lg border border-dashed border-border bg-secondary text-muted-foreground transition hover:border-primary-ink/40 hover:text-foreground"
        >
          <Plus className="size-4" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}
