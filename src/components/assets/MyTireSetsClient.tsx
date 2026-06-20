"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { formatAssetMeta } from "@/lib/assets/formatAssetMeta";
import { tireSetDisplayLine } from "@/lib/tires/tireSelectionFromSet";
import type { TireSetApiRow } from "@/lib/assets/createAssetApi";
import { AssetListRow } from "@/components/assets/AssetListRow";
import { CardPanel } from "@/components/ui/CardPanel";
import { QuickAddTireSetPanel } from "@/components/assets/QuickAddTireSetPanel";
import { deleteTireSetApi } from "@/lib/assets/createAssetApi";

export type TireSetListItemClient = {
  id: string;
  displayLine: string;
  setNumber: number;
  initialRunCount: number;
  notes: string | null;
  tireType: { id: string; displayName: string; modelCode: string } | null;
  stats: { runCount: number; effectiveTotal: number | null };
};

function toListItem(row: TireSetApiRow, stats = { runCount: 0, effectiveTotal: row.initialRunCount ?? 0 }): TireSetListItemClient {
  return {
    id: row.id,
    displayLine: tireSetDisplayLine(row),
    setNumber: row.setNumber ?? 1,
    initialRunCount: row.initialRunCount ?? 0,
    notes: null,
    tireType: row.tireType ?? null,
    stats,
  };
}

export function MyTireSetsClient({ initialTireSets }: { initialTireSets: TireSetListItemClient[] }) {
  const router = useRouter();
  const [tireSets, setTireSets] = useState(initialTireSets);
  const [showAdd, setShowAdd] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function handleCreated(row: TireSetApiRow) {
    const item = toListItem(row);
    setTireSets((prev) => {
      const rest = prev.filter((t) => t.id !== item.id);
      return [item, ...rest].sort((a, b) => a.displayLine.localeCompare(b.displayLine));
    });
    setShowAdd(false);
    setMessage("Tire set added.");
    router.refresh();
  }

  async function handleDelete(id: string) {
    await deleteTireSetApi(id);
    setTireSets((prev) => prev.filter((t) => t.id !== id));
    setMessage(null);
    router.refresh();
  }

  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="ui-caption text-muted-foreground">
          {tireSets.length === 0 ? "No tire sets yet." : `${tireSets.length} tire set${tireSets.length === 1 ? "" : "s"}`}
        </p>
        {!showAdd ? (
          <button type="button" className="btn-surface px-3 py-1.5 text-xs" onClick={() => setShowAdd(true)}>
            Add tire set
          </button>
        ) : null}
      </div>

      {message ? <p className="text-[11px] text-muted-foreground">{message}</p> : null}

      {showAdd ? (
        <QuickAddTireSetPanel
          onCreated={handleCreated}
          onCancel={() => {
            setShowAdd(false);
            setMessage(null);
          }}
        />
      ) : null}

      {tireSets.length === 0 && !showAdd ? (
        <CardPanel contentClassName="text-sm text-muted-foreground">
          Add a tire set here or{" "}
          <Link href="/runs/new" prefetch className="text-primary hover:underline">
            log a run
          </Link>{" "}
          and pick a compound in the Tires tab.
        </CardPanel>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {tireSets.map((row) => (
            <li key={row.id}>
              <AssetListRow
                href={`/tire-sets/${row.id}`}
                title={row.displayLine}
                meta={formatAssetMeta(row.stats)}
                runCount={row.stats.runCount}
                onDelete={() => handleDelete(row.id)}
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
  );
}
