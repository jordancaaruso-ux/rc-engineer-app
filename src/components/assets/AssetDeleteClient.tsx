"use client";

import { useRouter } from "next/navigation";
import { AssetDeleteButton } from "@/components/assets/AssetDeleteButton";
import { deleteBatteryApi, deleteTireSetApi } from "@/lib/assets/createAssetApi";

export function TireSetDeleteClient({
  tireSetId,
  displayLine,
  runCount,
}: {
  tireSetId: string;
  displayLine: string;
  runCount: number;
}) {
  const router = useRouter();

  return (
    <AssetDeleteButton
      label={displayLine}
      runCount={runCount}
      size="sm"
      onDelete={async () => {
        await deleteTireSetApi(tireSetId);
        router.push("/tire-sets");
        router.refresh();
      }}
    />
  );
}

export function BatteryDeleteClient({
  batteryId,
  displayLine,
  runCount,
}: {
  batteryId: string;
  displayLine: string;
  runCount: number;
}) {
  const router = useRouter();

  return (
    <AssetDeleteButton
      label={displayLine}
      runCount={runCount}
      size="sm"
      onDelete={async () => {
        await deleteBatteryApi(batteryId);
        router.push("/batteries");
        router.refresh();
      }}
    />
  );
}
