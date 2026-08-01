import type { ReactNode } from "react";
import { isFeatureLockedForCurrentUser } from "@/lib/entitlementGuards";
import { ProLockedPanel } from "@/components/billing/ProLockedPanel";

/**
 * Pro gate for the Roll Center Lab (the page itself is client-heavy, so the entitlement check
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
        <header className="page-header">
          <div>
            <h1 className="page-title">Roll Center Lab</h1>
            <p className="page-subtitle">Interactive suspension geometry, straight from your sheets.</p>
          </div>
        </header>
        <ProLockedPanel
          title="Roll Center Lab"
          blurb="Move shims and ride height and watch the roll center respond — load any run or saved setup and test geometry changes before you touch the car."
        />
      </>
    );
  }
  return <>{children}</>;
}
