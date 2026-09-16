import { CardPanel } from "@/components/ui/CardPanel";
import { BandHeader } from "@/components/ui/BandHeader";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { TIER_LABELS } from "@/lib/brand/brandNames";
import type { PaidTier } from "@/lib/entitlementLogic";

/**
 * A bench the member's plan doesn't include, drawn in the bench's own place on Tools.
 *
 * Tools used to show every bench to every plan and keep the lock one tap further in: a Starter
 * member met "Log a run · Open the lab" on the page, tapped Open the lab, and got "not available"
 * (founder, 2026-09-15). The page was offering a door it knew was shut. So the lock is drawn where
 * the bench stands, in the words every locked surface uses (`ProLockedPanel`): which plan includes
 * it, and the door to that plan. `line` is the one line on what the bench does that the
 * visible-but-locked ruling allows (MONETISATION_NORTH_STAR.md), and no more.
 *
 * The frame is the open benches' own (band on top, door pinned to the foot, `h-full`), so on the
 * three-across desktop grid a locked bench stands level with an open one beside it. The door is
 * yellow for the reason the Lab's lone door is: the only action on a band is never a quiet one.
 * It carries `?plan=`, so the Subscription page opens with that plan picked (see `BillingClient`).
 */
export function LockedBench({
  label,
  includedIn,
  line,
}: {
  label: string;
  includedIn: PaidTier;
  line: string;
}) {
  const plan = TIER_LABELS[includedIn];
  return (
    <CardPanel className="h-full" contentClassName="flex h-full flex-col p-0">
      <BandHeader label={label} />
      <div className="px-4 pb-4 pt-3">
        <p className="micro-caps text-muted-foreground">Included in {plan}</p>
        <p className="ui-title mt-1.5 text-[17px] font-bold leading-snug tracking-tight text-foreground">
          {line}
        </p>
      </div>
      <div className="mt-auto flex items-center justify-end border-t border-border bg-muted/40 px-4 py-2.5">
        <ButtonLink href={`/billing?plan=${includedIn}`}>Upgrade to {plan}</ButtonLink>
      </div>
    </CardPanel>
  );
}
