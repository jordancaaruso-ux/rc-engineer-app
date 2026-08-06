import type { ReactNode } from "react";
import { CardPanel } from "@/components/ui/CardPanel";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { TIER_LABELS } from "@/lib/brand/brandNames";
import Link from "next/link";

/**
 * Visible-but-locked state for the top tier's features (MONETISATION_NORTH_STAR.md, founder-locked
 * 2026-08-01): Notebook subscribers keep seeing those surfaces in the nav, and the page itself
 * sells the upgrade — this is the only upsell channel that exists once there is no free tier.
 * Never a bare error: one line on what the feature does, then the door.
 *
 * Component name kept as-is: "pro" is still the internal tier id, and renaming the file would
 * churn every import for a string that is now read from `TIER_LABELS`.
 */
export function ProLockedPanel({
  title,
  blurb,
}: {
  title: string;
  blurb: string;
}): ReactNode {
  return (
    <section className="page-body">
      <CardPanel className="mx-auto w-full max-w-xl" contentClassName="p-6 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Included in {TIER_LABELS.pro}
        </p>
        <h2 className="mt-2 text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{blurb}</p>
        <div className="mt-5">
          <Link href="/billing" className={buttonLinkClassName("primary")}>
            Upgrade to {TIER_LABELS.pro}
          </Link>
        </div>
      </CardPanel>
    </section>
  );
}
