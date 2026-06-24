import type { ReactNode } from "react";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { loadUserTireSetsForList } from "@/lib/assets/loadUserAssets";
import { MyTireSetsClient } from "@/components/assets/MyTireSetsClient";
import { CardPanel } from "@/components/ui/CardPanel";
import { PageBackLink } from "@/components/ui/PageBackLink";

export const revalidate = 30;

export default async function MyTireSetsPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/assets" />
            <div>
              <h1 className="page-title">My tires</h1>
              <p className="page-subtitle">Database not configured.</p>
            </div>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-2xl" contentClassName="text-sm text-muted-foreground">
            Set DATABASE_URL in .env to view your tire sets.
          </CardPanel>
        </section>
      </>
    );
  }

  const user = await requireCurrentUser();
  const tireSets = await loadUserTireSetsForList(user.id);

  const initialTireSets = tireSets.map((row) => ({
    id: row.id,
    displayLine: row.displayLine,
    setNumber: row.setNumber,
    initialRunCount: row.initialRunCount,
    notes: row.notes,
    tireType: row.tireType,
    stats: row.stats,
  }));

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/assets" />
          <div>
            <h1 className="page-title">My tires</h1>
            <p className="page-subtitle">Tire sets you have logged or added here.</p>
          </div>
        </div>
      </header>
      <section className="page-body">
        <MyTireSetsClient initialTireSets={initialTireSets} />
      </section>
    </>
  );
}
