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
 * ── The band, 2026-09-15 ─────────────────────────────────────────────────────────────────────
 * The row is `.eyebrow-band` — the same tinted header, with the same one full-bleed hairline,
 * that every card in the app now opens on (founder pick off the Heading Height Bench). The `+`
 * is DRAWN at 24px and pulled 5px into the row, so the 11px label sets the band's 29px height,
 * not the button; its TAP area is an invisible 44px square hung off it (`after:-inset-2.5`),
 * bigger than the 36px button it replaced. Drawn size and tap size are separate things — this
 * used to trade one for the other. An `action` in the right-hand slot is held to the same 24px.
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
    <div className="eyebrow-band flex items-center justify-between gap-3 px-4">
      {/* The raw `.eyebrow-label` span, not the `Eyebrow` wrapper: the wrapper brings `mb-2`,
          spacing for a heading that sits above content, not for one that IS a row. */}
      <span className="eyebrow-label min-w-0">{label}</span>
      {action ? (
        <span className="-my-[5px] flex shrink-0 items-center">{action}</span>
      ) : addHref ? (
        <Link
          href={addHref}
          aria-label={addLabel ?? `Add to ${label}`}
          title={addLabel ?? `Add to ${label}`}
          className="tap-active relative -my-[5px] grid size-6 shrink-0 place-items-center rounded-md border border-dashed border-border bg-secondary text-muted-foreground transition after:absolute after:-inset-2.5 hover:border-primary-ink/40 hover:text-foreground"
        >
          <Plus className="size-3.5" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}
