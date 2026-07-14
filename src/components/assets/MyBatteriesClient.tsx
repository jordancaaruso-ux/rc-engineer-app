"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { formatAssetMeta } from "@/lib/assets/formatAssetMeta";
import type { BatteryApiRow } from "@/lib/assets/createAssetApi";
import { batteryDisplayLabel } from "@/lib/assets/batteryDisplay";
import { AssetListRow } from "@/components/assets/AssetListRow";
import { CollapsibleAddRow } from "@/components/assets/CollapsibleAddRow";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { QuickAddBatteryPanel } from "@/components/assets/QuickAddBatteryPanel";
import { deleteBatteryApi } from "@/lib/assets/createAssetApi";

export type BatteryListItemClient = {
  id: string;
  displayLine: string;
  packNumber: number;
  initialRunCount: number;
  notes: string | null;
  stats: { runCount: number; effectiveTotal: number | null };
};

function toListItem(row: BatteryApiRow, stats = { runCount: 0, effectiveTotal: row.initialRunCount ?? 0 }): BatteryListItemClient {
  return {
    id: row.id,
    displayLine: batteryDisplayLabel(row),
    packNumber: row.packNumber ?? 1,
    initialRunCount: row.initialRunCount ?? 0,
    notes: row.notes ?? null,
    stats,
  };
}

export function MyBatteriesClient({ initialBatteries }: { initialBatteries: BatteryListItemClient[] }) {
  const router = useRouter();
  const [batteries, setBatteries] = useState(initialBatteries);
  const [showAdd, setShowAdd] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function handleCreated(row: BatteryApiRow) {
    const item = toListItem(row);
    setBatteries((prev) => {
      const rest = prev.filter((b) => b.id !== item.id);
      return [item, ...rest].sort((a, b) => a.displayLine.localeCompare(b.displayLine));
    });
    setShowAdd(false);
    setMessage("Battery pack added.");
    router.refresh();
  }

  async function handleDelete(id: string) {
    await deleteBatteryApi(id);
    setBatteries((prev) => prev.filter((b) => b.id !== id));
    setMessage(null);
    router.refresh();
  }

  return (
    <div className="max-w-2xl space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="ui-caption text-muted-foreground">
          {batteries.length === 0
            ? "No batteries yet."
            : `${batteries.length} pack${batteries.length === 1 ? "" : "s"}`}
        </p>
        {message ? <p className="text-[11px] text-muted-foreground">{message}</p> : null}
      </div>

      <SurfaceCard variant="panel" contentClassName="p-0" overflowHidden={false}>
        <ul className="divide-y divide-border">
          <CollapsibleAddRow
            label="Add battery"
            open={showAdd}
            onOpenChange={(next) => {
              setShowAdd(next);
              if (!next) setMessage(null);
            }}
          >
            <QuickAddBatteryPanel
              onCreated={handleCreated}
              onCancel={() => {
                setShowAdd(false);
                setMessage(null);
              }}
            />
          </CollapsibleAddRow>

          {batteries.length === 0 ? (
            <li className="px-4 py-4 text-sm text-muted-foreground">
              Add a battery pack here or{" "}
              <Link href="/runs/new" prefetch className="text-primary hover:underline">
                log a run
              </Link>{" "}
              and pick a pack in the Battery tab.
            </li>
          ) : (
            batteries.map((row) => (
              <li key={row.id}>
                <AssetListRow
                  flush
                  href={`/batteries/${row.id}`}
                  title={row.displayLine}
                  meta={formatAssetMeta(row.stats)}
                  runCount={row.stats.runCount}
                  onDelete={() => handleDelete(row.id)}
                />
              </li>
            ))
          )}
        </ul>
      </SurfaceCard>
    </div>
  );
}
