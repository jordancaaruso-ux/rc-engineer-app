import type { ReactNode } from "react";
import { CardPanel } from "@/components/ui/CardPanel";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { TIER_LABELS } from "@/lib/brand/brandNames";
import type { PaidTier } from "@/lib/entitlementLogic";
import Link from "next/link";

/**
 * Visible-but-locked state for a feature the viewer's tier lacks (MONETISATION_NORTH_STAR.md,
 * founder-locked 2026-08-01): subscribers one tier short keep seeing those surfaces in the nav,
 * and the page itself sells the upgrade — this is the only upsell channel that exists once there
 * is no free tier. Never a bare error: one line on what the feature does, then the door.
 *
 * `includedIn` is the tier the door sells, from `upgradeTierFor`: Race Engineer for video, the
 * Geometry Lab (the default) and the Engineer. Notebook's one Engineer question a day is a taste,
 * not the feature, so Starter's locked Engineer points past it (founder call 2026-09-15).
 *
 * The door carries `?plan=`, so the Subscription page opens with the plan it names already
 * picked (the phone preselects one plan; without this a Notebook door landed on Race Engineer).
 * Inside the iPhone/Android app the door is hidden (`web-only`, globals.css): the app sells
 * nothing, so there the panel only says which plan includes the feature.
 *
 * Component name kept as-is: "pro" is still the internal tier id, and renaming the file would
 * churn every import for a string that is now read from `TIER_LABELS`.
 */
export function ProLockedPanel({
  title,
  blurb,
  includedIn = "pro",
}: {
  title: string;
  blurb: string;
  includedIn?: PaidTier;
}): ReactNode {
  const label = TIER_LABELS[includedIn];
  return (
    <section className="page-body">
      <CardPanel className="mx-auto w-full max-w-xl" contentClassName="p-6 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Included in {label}
        </p>
        <h2 className="mt-2 text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{blurb}</p>
        <div className="web-only mt-5">
          <Link href={`/billing?plan=${includedIn}`} className={buttonLinkClassName("primary")}>
            Upgrade to {label}
          </Link>
        </div>
      </CardPanel>
    </section>
  );
}
