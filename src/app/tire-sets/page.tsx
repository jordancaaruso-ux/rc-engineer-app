import type { ReactNode } from "react";
import Link from "next/link";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { formatAssetMeta } from "@/lib/assets/formatAssetMeta";
import { loadUserTireSetsForList } from "@/lib/assets/loadUserAssets";
import { AssetListRow } from "@/components/assets/AssetListRow";
import { CardPanel } from "@/components/ui/CardPanel";

export const revalidate = 30;

export default async function MyTireSetsPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">My tires</h1>
            <p className="page-subtitle">Database not configured.</p>
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

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">My tires</h1>
          <p className="page-subtitle">
            Tire sets you have logged on runs. Add new sets when you log a run.
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
          {tireSets.length === 0 ? (
            <CardPanel contentClassName="text-sm text-muted-foreground">
              No tire sets yet.{" "}
              <Link href="/runs/new" prefetch className="text-primary hover:underline">
                Log a run
              </Link>{" "}
              and pick or create a set.
            </CardPanel>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {tireSets.map((row) => (
                <li key={row.id}>
                  <AssetListRow
                    href={`/tire-sets/${row.id}`}
                    title={row.displayLine}
                    meta={formatAssetMeta(row.stats)}
                  />
                </li>
              ))}
            </ul>
          )}
          <p className="ui-caption text-muted-foreground">
            Tire compounds live in the{" "}
            <Link href="/tires" prefetch className="text-primary hover:underline">
              tire type catalog
            </Link>
            .
          </p>
        </div>
      </section>
    </>
  );
}
