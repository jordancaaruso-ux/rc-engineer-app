import { cn } from "@/lib/utils";

/**
 * The heading an outing wears — its own name and when it happened.
 *
 *     TFTR TESTING                                 19 July 2026
 *     ───────────────────────────────────────────────────────
 *
 * ONE component, two homes: the top of `/analysis` and the top of the Sessions day
 * screen's chart. Both are a picture of one day, and a picture of a day has to say
 * which day — the chart read as four generic grey lines until something above it
 * did (founder call, 2026-08-25).
 *
 * ## No badge (founder pin, 2026-08-26)
 *
 * The kind used to ride here as a bordered pill — a wrench glyph and "TEST DAY" in
 * 9.5px caps. Nothing else in the app heads a card that way, so it read as a part
 * borrowed from another product. The word lives in the title now ("TFTR testing",
 * composed once in `resolveOutingHeading` so both surfaces say it the same way),
 * and this is a heading and a date again. Do not re-add the pill.
 *
 * Composed by hand rather than through `<Eyebrow>`, the same way the trend card's
 * own header is, so the date can ride the label's row. The classes ARE the eyebrow
 * system's: this is the card's heading, not a title sitting under one, and the name
 * is what the driver came to read — not a label announcing which card they are
 * looking at.
 */
export function OutingHeading({
  title,
  where,
  className,
}: {
  /** The heading line: a meeting's name, "<track> testing", else "Test day". */
  title: string;
  /** Everything the title isn't: the date, plus the track when a meeting took the name. */
  where: string;
  className?: string;
}) {
  return (
    <div className={cn("eyebrow-root flex items-baseline gap-2", className)}>
      <h2 className="eyebrow-label min-w-0">
        <span className="min-w-0 truncate">{title}</span>
      </h2>
      {where ? (
        <span className="ml-auto shrink-0 whitespace-nowrap text-[11.5px] text-muted-foreground">
          {where}
        </span>
      ) : null}
    </div>
  );
}
