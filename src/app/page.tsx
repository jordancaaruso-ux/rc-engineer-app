import type { ReactNode } from "react";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getCachedDashboardHomeModel } from "@/lib/cachedReads";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { DashboardHome } from "@/components/dashboard/DashboardHome";
import { CardPanel } from "@/components/ui/CardPanel";

export default async function DashboardPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Dashboard</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-2xl" contentClassName="text-sm text-muted-foreground">
            Set <span className="font-mono">DATABASE_URL</span> in <span className="font-mono">.env</span>{" "}
            to load your dashboard.
          </CardPanel>
        </section>
      </>
    );
  }

  const [user, displayTimeZone] = await Promise.all([
    requireCurrentUser(),
    getExplicitTimeZoneForRunFormatting(),
  ]);
  const model = await getCachedDashboardHomeModel(user.id, displayTimeZone);

  return <DashboardHome model={model} displayTimeZone={displayTimeZone} />;
}
