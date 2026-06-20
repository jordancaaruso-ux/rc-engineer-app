import type { ReactNode } from "react";
import Link from "next/link";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { loadUserBatteriesForList } from "@/lib/assets/loadUserAssets";
import { MyBatteriesClient } from "@/components/assets/MyBatteriesClient";
import { CardPanel } from "@/components/ui/CardPanel";

export const revalidate = 30;

export default async function MyBatteriesPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">My batteries</h1>
            <p className="page-subtitle">Database not configured.</p>
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
        <div>
          <h1 className="page-title">My batteries</h1>
          <p className="page-subtitle">Battery packs you have logged or added here.</p>
        </div>
        <Link
          href="/assets"
          className="rounded-md border border-border bg-card px-4 py-2 text-xs hover:bg-muted transition"
        >
          Back
        </Link>
      </header>
      <section className="page-body">
        <MyBatteriesClient initialBatteries={initialBatteries} />
      </section>
    </>
  );
}
