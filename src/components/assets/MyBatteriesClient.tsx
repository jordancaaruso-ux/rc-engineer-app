"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { formatAssetMeta } from "@/lib/assets/formatAssetMeta";
import type { BatteryApiRow } from "@/lib/assets/createAssetApi";
import { batteryDisplayLabel } from "@/lib/assets/batteryDisplay";
import { AssetListRow } from "@/components/assets/AssetListRow";
import { CardPanel } from "@/components/ui/CardPanel";
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
    <div className="max-w-2xl space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="ui-caption text-muted-foreground">
          {batteries.length === 0
            ? "No batteries yet."
            : `${batteries.length} pack${batteries.length === 1 ? "" : "s"}`}
        </p>
        {!showAdd ? (
          <button type="button" className="btn-surface px-3 py-1.5 text-xs" onClick={() => setShowAdd(true)}>
            Add battery
          </button>
        ) : null}
      </div>

      {message ? <p className="text-[11px] text-muted-foreground">{message}</p> : null}

      {showAdd ? (
        <QuickAddBatteryPanel
          onCreated={handleCreated}
          onCancel={() => {
            setShowAdd(false);
            setMessage(null);
          }}
        />
      ) : null}

      {batteries.length === 0 && !showAdd ? (
        <CardPanel contentClassName="text-sm text-muted-foreground">
          Add a battery pack here or{" "}
          <Link href="/runs/new" prefetch className="text-primary hover:underline">
            log a run
          </Link>{" "}
          and pick a pack in the Battery tab.
        </CardPanel>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {batteries.map((row) => (
            <li key={row.id}>
              <AssetListRow
                href={`/batteries/${row.id}`}
                title={row.displayLine}
                meta={formatAssetMeta(row.stats)}
                runCount={row.stats.runCount}
                onDelete={() => handleDelete(row.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
