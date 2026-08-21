import Link from "next/link";
import { Car } from "lucide-react";
import { CardPanel } from "@/components/ui/CardPanel";
import { BandHeader } from "@/components/ui/BandHeader";
import { BandFoot } from "@/components/paddock/BandFoot";
import { RowChevron } from "@/components/paddock/RowChevron";
import type { PaddockCar } from "@/lib/paddock/paddockModel";

/**
 * The cars band — five names and a door.
 *
 * `/more` listed a door called "Garage" with a sentence under it explaining what a garage is.
 * This shows the cars instead.
 *
 * ── Plain lists, 2026-08-19 ──────────────────────────────────────────────────────────────────
 * A row is a name and a way in. Founder call, and it is the third cut this card has taken in two
 * days: five figures went to two (a setup count restates the rows below it, a sheet count is
 * filing rather than state, a best lap belongs to a track and not a car), the last two went by
 * pin the same morning, and now the rest of the furniture has followed them.
 *
 * What came off, and why none of it is worth putting back:
 *
 * - **The expanded first car.** It existed to hold the figures. With nothing to hold, "bigger"
 *   was the only thing left saying it, and a row that is bigger for no reason reads as a
 *   different KIND of thing — which it isn't. Every row is now the same row.
 * - **The chassis line.** `isSameThing()` lived here to suppress "AWESOMATIX A800RR" under a car
 *   named "A800RR", because most drivers name the car after the chassis and the card looked like
 *   it had two titles. Gone with the second line, and the helper with it.
 * - **The last-run date.** The pin that started this.
 * - **The nested setups.** The real decision, and the one that made the rest inevitable. Telling
 *   a setup row apart from a car row took FOUR signals — body weight against the car's 600, an
 *   indent behind a hairline dropped from the card's left edge, a smaller and fainter chevron,
 *   and "a car carries a date, a setup carries a run count". Two of those four were the date and
 *   the count. Once they came off, the choice was rebuild the distinction or drop the rows; they
 *   dropped. Every setup is on the car page, in full, with its source chips, one tap away.
 *
 * FIVE rows, not three. See `MAX_CARS` — the count follows from the row losing two thirds of its
 * height, and three names under this door left the exit bigger than the card.
 *
 * The order is unchanged: `orderCarsByRecentUse`, most recently run first, added-date as the
 * tie-break. It is now completely unstated, which the founder was shown and accepted — "ordered
 * by most recently used" printed on screen would be the explanatory sentence this page exists to
 * delete. The cost is real though: nothing here says why the top car is the top car.
 */
export function PaddockCars({
  cars,
  total,
}: {
  cars: PaddockCar[];
  total: number;
}) {
  if (cars.length === 0) return null;

  return (
    <CardPanel contentClassName="p-0">
      <BandHeader label="Cars" addHref="/cars" addLabel="Add a car" />

      {cars.map((car, index) => (
        <Link
          key={car.id}
          href={`/cars/${encodeURIComponent(car.id)}`}
          className={`tap-active group flex items-center gap-3 px-4 py-3 transition hover:bg-muted/40 ${
            index > 0 ? "border-t border-border/60" : ""
          }`}
        >
          <span className="ui-title min-w-0 flex-1 truncate text-[13.5px] font-semibold text-foreground">
            {car.name}
          </span>
          <RowChevron />
        </Link>
      ))}

      <BandFoot
        href="/cars"
        icon={Car}
        title="All your cars"
        detail="Setups, sheets, tyres and baselines"
        /* The count only when there is something hidden. "View all 1 car" is a button that
           promises a room and opens a cupboard, so below the cap it names the place instead. */
        action={
          total > cars.length ? `View all ${total} cars` : "Open the garage"
        }
      />
    </CardPanel>
  );
}
