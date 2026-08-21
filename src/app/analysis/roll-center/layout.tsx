import type { ReactNode } from "react";
import { isFeatureLockedForCurrentUser } from "@/lib/entitlementGuards";
import { ProLockedPanel } from "@/components/billing/ProLockedPanel";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { LAB_DEFAULT_BACK } from "@/lib/rollCenter/labReturn";

/**
 * Pro gate for the Geometry Lab (the page itself is client-heavy, so the entitlement check
 * lives in this segment layout). Standard subscribers see the visible-but-locked upsell —
 * MONETISATION_NORTH_STAR.md Phase 2. While billing is dark this renders children untouched.
 */
export default async function RollCenterLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  if (await isFeatureLockedForCurrentUser("roll-center")) {
    return (
      <>
        {/* The locked twin gets the arrow too, but hardwired: a layout can't read search params,
            so it can't honour the caller's `?back=`. Tools is the Lab's own dock cell and the
            right default — and a locked driver came from a door, not from a sheet. */}
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href={LAB_DEFAULT_BACK} />
            <div>
              <h1 className="page-title">Geometry Lab</h1>
              <p className="page-subtitle">
                Interactive suspension geometry, straight from your sheets.
              </p>
            </div>
          </div>
        </header>
        <ProLockedPanel
          title="Geometry Lab"
          blurb="Move shims and ride height and watch the roll center respond — load any run or saved setup and test geometry changes before you touch the car."
        />
      </>
    );
  }
  return <>{children}</>;
}
