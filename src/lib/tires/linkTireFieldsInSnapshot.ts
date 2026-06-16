import { prisma } from "@/lib/prisma";
import { bestTireTypeMatch } from "@/lib/tires/matchTireType";
import { buildTireSelectionValue } from "@/lib/tires/tireSelectionValue";
import { isTireFieldKey } from "@/lib/tires/tireSelectionValue";
import type { SetupSnapshotData } from "@/lib/runSetup";

/** Attempt to link free-text tire fields in snapshot data to TireType catalog. */
export async function linkTireFieldsInSnapshotData(
  data: SetupSnapshotData
): Promise<SetupSnapshotData> {
  const catalog = await prisma.tireType.findMany({
    select: { id: true, displayName: true, modelCode: true },
  });
  if (catalog.length === 0) return data;

  const out: SetupSnapshotData = { ...data };
  let changed = false;
  for (const key of Object.keys(data)) {
    if (!isTireFieldKey(key)) continue;
    const v = data[key];
    if (typeof v !== "string" || !v.trim()) continue;
    const match = bestTireTypeMatch(v, catalog);
    if (!match) continue;
    out[key] = buildTireSelectionValue({
      tireTypeId: match.id,
      displayName: match.displayName,
    });
    changed = true;
  }
  return changed ? out : data;
}
