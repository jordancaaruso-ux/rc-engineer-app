import type { ReactNode } from "react";
import { isFeatureLockedForCurrentUser } from "@/lib/entitlementGuards";
import { ProLockedPanel } from "@/components/billing/ProLockedPanel";

/**
 * Pro gate for every /videos/* page (several are client components, so the entitlement check
 * lives in this segment layout). Standard subscribers see the visible-but-locked upsell —
 * MONETISATION_NORTH_STAR.md Phase 2. While billing is dark this renders children untouched.
 */
export default async function VideosLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  if (await isFeatureLockedForCurrentUser("video")) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Video</h1>
            <p className="page-subtitle">Frame-accurate video analysis, synced to your laps.</p>
          </div>
        </header>
        <ProLockedPanel
          title="Video analysis"
          blurb="Sync race footage to your lap times and see exactly where the stopwatch moves — corner by corner, run against run."
        />
      </>
    );
  }
  return <>{children}</>;
}
