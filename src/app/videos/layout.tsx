import type { ReactNode } from "react";
import { requireCurrentUser } from "@/lib/currentUser";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { CardPanel } from "@/components/ui/CardPanel";

/**
 * Video is CLOSED for release (founder call 2026-08-02): the door stays visible but doesn't
 * open until there's a really good video comparison to show — for every non-admin tier,
 * including Pro and the demo. The admin (founder) still gets the real pages to keep building.
 * When video ships: restore the Pro gate (`isFeatureLockedForCurrentUser("video")` +
 * `ProLockedPanel`) that this temporarily replaces, and update /join's "Soon" row.
 */
export default async function VideosLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  const user = await requireCurrentUser();
  if (isAuthAdminEmail(user.email)) return <>{children}</>;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Video</h1>
          <p className="page-subtitle">Frame-accurate video analysis, synced to your laps.</p>
        </div>
      </header>
      <section className="page-body">
        <CardPanel className="mx-auto w-full max-w-xl" contentClassName="p-6 text-center">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            In final testing
          </p>
          <h2 className="mt-2 text-lg font-semibold">Video analysis is almost here</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Sync race footage to your lap times and see exactly where the stopwatch moves —
            corner by corner, run against run. It opens as soon as it&rsquo;s race-proven.
          </p>
        </CardPanel>
      </section>
    </>
  );
}
