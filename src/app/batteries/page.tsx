import type { ReactNode } from "react";
import Link from "next/link";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { formatAssetMeta } from "@/lib/assets/formatAssetMeta";
import { loadUserBatteriesForList } from "@/lib/assets/loadUserAssets";
import { AssetListRow } from "@/components/assets/AssetListRow";
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

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">My batteries</h1>
          <p className="page-subtitle">
            Battery packs you have logged on runs. Add new packs when you log a run.
          </p>
        </div>
        <Link
          href="/assets"
          className="rounded-md border border-border bg-card px-4 py-2 text-xs hover:bg-muted transition"
        >
          Back
        </Link>
      </header>
      <section className="page-body">
        <div className="max-w-2xl space-y-3">
          {batteries.length === 0 ? (
            <CardPanel contentClassName="text-sm text-muted-foreground">
              No batteries yet.{" "}
              <Link href="/runs/new" prefetch className="text-primary hover:underline">
                Log a run
              </Link>{" "}
              and pick or create a pack.
            </CardPanel>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {batteries.map((row) => (
                <li key={row.id}>
                  <AssetListRow
                    href={`/batteries/${row.id}`}
                    title={row.displayLine}
                    meta={formatAssetMeta(row.stats)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
