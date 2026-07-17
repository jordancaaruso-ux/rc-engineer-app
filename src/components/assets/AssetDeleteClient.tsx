"use client";

import { useRouter } from "next/navigation";
import { AssetDeleteButton } from "@/components/assets/AssetDeleteButton";
import { deleteTireSetApi } from "@/lib/assets/createAssetApi";

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
