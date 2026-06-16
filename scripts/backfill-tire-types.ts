import { prisma } from "@/lib/prisma";
import { ensureSeedTireTypes } from "@/lib/tires/ensureSeedTireTypes";
import { bestTireTypeMatch } from "@/lib/tires/matchTireType";
import { buildTireSelectionValue } from "@/lib/tires/tireSelectionValue";
import { normalizeSetupSnapshotForStorage, type SetupSnapshotData } from "@/lib/runSetup";
import { isTireFieldKey } from "@/lib/tires/tireSelectionValue";

async function main() {
  await ensureSeedTireTypes();
  const catalog = await prisma.tireType.findMany({
    select: { id: true, displayName: true, modelCode: true },
  });

  let tireSetsLinked = 0;
  const tireSets = await prisma.tireSet.findMany({
    where: { tireTypeId: null },
    select: { id: true, label: true },
  });
  for (const ts of tireSets) {
    const match = bestTireTypeMatch(ts.label, catalog);
    if (!match) continue;
    await prisma.tireSet.update({
      where: { id: ts.id },
      data: { tireTypeId: match.id },
    });
    tireSetsLinked++;
  }

  let eventsLinked = 0;
  const events = await prisma.event.findMany({
    where: { controlledTireTypeId: null, controlledTireLabel: { not: null } },
    select: { id: true, controlledTireLabel: true },
  });
  for (const ev of events) {
    const label = ev.controlledTireLabel?.trim();
    if (!label) continue;
    const match = bestTireTypeMatch(label, catalog);
    if (!match) continue;
    await prisma.event.update({
      where: { id: ev.id },
      data: { controlledTireTypeId: match.id },
    });
    eventsLinked++;
  }

  let snapshotsUpdated = 0;
  const snapshots = await prisma.setupSnapshot.findMany({
    select: { id: true, data: true },
    take: 5000,
    orderBy: { createdAt: "desc" },
  });
  for (const snap of snapshots) {
    const data = normalizeSetupSnapshotForStorage(snap.data) as SetupSnapshotData;
    let changed = false;
    const next: SetupSnapshotData = { ...data };
    for (const key of Object.keys(data)) {
      if (!isTireFieldKey(key)) continue;
      const v = data[key];
      if (typeof v !== "string" || !v.trim()) continue;
      const match = bestTireTypeMatch(v, catalog);
      if (!match) continue;
      next[key] = buildTireSelectionValue({
        tireTypeId: match.id,
        displayName: match.displayName,
      });
      changed = true;
    }
    if (changed) {
      await prisma.setupSnapshot.update({
        where: { id: snap.id },
        data: { data: next as object },
      });
      snapshotsUpdated++;
    }
  }

  console.log(
    JSON.stringify({ tireSetsLinked, eventsLinked, snapshotsUpdated, catalogSize: catalog.length }, null, 2)
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
