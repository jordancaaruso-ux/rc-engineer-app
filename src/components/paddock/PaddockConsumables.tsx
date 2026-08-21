import Link from "next/link";
import { type LucideIcon } from "lucide-react";
import { CardPanel } from "@/components/ui/CardPanel";
import { BandHeader } from "@/components/ui/BandHeader";
import { BandFoot } from "@/components/paddock/BandFoot";
import { RowChevron } from "@/components/paddock/RowChevron";
import type { PaddockConsumable } from "@/lib/paddock/paddockModel";

/**
 * The consumables bands — Tyres and Additives — as ONE component drawn twice.
 *
 * Founder pin on `/paddock` (2026-08-19): "2 completely new cards, 1 with all the tires +
 * favourites / recently used and same for additive. that way it rounds out paddock as 'all
 * assets' sort of thing." Two cards, and they are the same card. Writing that twice is how two
 * bands that must look identical stop looking identical — the warning `BandFoot` and `BandHeader`
 * both carry, and the reason those are single components too.
 *
 * ── What is on the row, and what came off ────────────────────────────────────────────────────
 * A name. Nothing else.
 *
 * The first draft put two extra lines on the expanded tyre — the control compound for your next
 * meeting, and what is bolted to the car right now with how far through the stint it is — and both
 * came off on the founder's call ("just how many runs"), because a band that answers three
 * questions answers none of them at a glance. The same instinct then took the run count too, one
 * pass later: every asset band on this page is a plain list now, so the kind-line ("Asphalt ·
 * rubber"), the count and the "last out" chip went with the expanded row that held them.
 *
 * The count is the loss worth naming. It was the one thing separating the staple from the compound
 * you tried once, and on this band that mattered more than on the others, because the ORDER is
 * recency: a tyre run once yesterday leads a tyre with forty runs on it. Both facts were on the
 * row and each explained the other. Now neither is. Put to the founder as the argument against and
 * he took the plain list; the retreat, if the top row ever reads wrong, is the comparator in
 * `topRecentUse`, not a figure added back here.
 *
 * ── Empty ────────────────────────────────────────────────────────────────────────────────────
 * Renders nothing until a run has used one, exactly as the cars band does with no cars and the
 * hero does with no meeting. Recency needs history, and a band explaining what traction compound
 * is would be the sentence `/more` was deleted for.
 */
export function PaddockConsumables({
  label,
  items,
  href,
  icon,
  addLabel,
  doorTitle,
  doorDetail,
  doorAction,
}: {
  /** The band's signpost — "Tyres", "Additives". */
  label: string;
  /** Most recently used first, already capped at `MAX_CONSUMABLES`. */
  items: PaddockConsumable[];
  /** The catalog page this band's `+` and door both lead to. */
  href: string;
  icon: LucideIcon;
  addLabel: string;
  doorTitle: string;
  doorDetail: string;
  doorAction: string;
}) {
  if (items.length === 0) return null;

  return (
    <CardPanel contentClassName="p-0">
      <BandHeader label={label} addHref={href} addLabel={addLabel} />

      {items.map((item, index) => (
        <Link
          key={item.id}
          href={href}
          className={`tap-active group flex items-center gap-3 px-4 py-3 transition hover:bg-muted/40 ${
            index > 0 ? "border-t border-border/60" : ""
          }`}
        >
          <span className="ui-title min-w-0 flex-1 truncate text-[13.5px] font-semibold text-foreground">
            {item.name}
          </span>
          <RowChevron />
        </Link>
      ))}

      <BandFoot
        href={href}
        icon={icon}
        title={doorTitle}
        detail={doorDetail}
        action={doorAction}
      />
    </CardPanel>
  );
}
