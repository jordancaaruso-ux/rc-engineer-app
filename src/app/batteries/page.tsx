import type { ReactNode } from "react";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { loadUserBatteriesForList } from "@/lib/assets/loadUserAssets";
import { MyBatteriesClient } from "@/components/assets/MyBatteriesClient";
import { CardPanel } from "@/components/ui/CardPanel";
import { PageBackLink } from "@/components/ui/PageBackLink";

export const revalidate = 30;

export default async function MyBatteriesPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/assets" />
            <div>
              <h1 className="page-title">My batteries</h1>
              <p className="page-subtitle">Database not configured.</p>
            </div>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-2xl" contentClassName="text-sm text-muted-foreground">
            Set DATABASE_URL in .env to view your battery packs.
          </CardPanel>
        </section>
      </>
    );
  }

  const user = await requireCurrentUser();
  const batteries = await loadUserBatteriesForList(user.id);

  const initialBatteries = batteries.map((row) => ({
    id: row.id,
    displayLine: row.displayLine,
    packNumber: row.packNumber,
    initialRunCount: row.initialRunCount,
    notes: row.notes,
    stats: row.stats,
  }));

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/assets" />
          <div>
            <h1 className="page-title">My batteries</h1>
            <p className="page-subtitle">Battery packs you have logged or added here.</p>
          </div>
        </div>
      </header>
      <section className="page-body">
        <MyBatteriesClient initialBatteries={initialBatteries} />
      </section>
    </>
  );
}
