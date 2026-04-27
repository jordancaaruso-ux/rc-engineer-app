import type { ReactNode } from "react";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { loadDashboardHomeModel } from "@/lib/dashboardServer";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { DashboardHome } from "@/components/dashboard/DashboardHome";

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
          <div className="max-w-2xl rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Set <span className="font-mono">DATABASE_URL</span> in <span className="font-mono">.env</span>{" "}
            to load your dashboard.
          </div>
        </section>
      </>
    );
  }

  const user = await requireCurrentUser();
  const model = await loadDashboardHomeModel(user.id);
  const displayTimeZone = await getExplicitTimeZoneForRunFormatting();

  return <DashboardHome model={model} displayTimeZone={displayTimeZone} />;
}
