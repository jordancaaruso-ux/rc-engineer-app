import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const IDS = [
  "cmsvngbmo0009jn04m9igexmz",
  "cmsvngv9o000gjn04oec3ehpo",
  "cmsvp2yms0005ld04wu3ojrth",
  "cmsvp6s530002l8047cvaqk2c",
  "cmsvspo55002bjk04peamv4ha",
  "cmsvsrt920036jk04w0pnli2t",
];

async function main() {
  const editionDocs = await prisma.setupDocument.findMany({
    where: { calibrationResolvedProfileId: "cmsvng6m00003jn04kr0nzqlw" },
    select: { id: true, createdSetupId: true },
  });
  const seeds = new Set(editionDocs.map((d) => d.createdSetupId).filter(Boolean) as string[]);
  console.log(`seed snapshots (edition imports): ${[...seeds].join(", ")}`);
  for (const id of IDS) {
    let cur: string | null = id;
    const chain: string[] = [];
    for (let i = 0; i < 10 && cur; i++) {
      chain.push(cur);
      if (seeds.has(cur)) break;
      const row: { baseSetupSnapshotId: string | null } | null = await prisma.setupSnapshot.findUnique({
        where: { id: cur },
        select: { baseSetupSnapshotId: true },
      });
      cur = row?.baseSetupSnapshotId ?? null;
    }
    const reaches = chain.some((c) => seeds.has(c));
    console.log(`${id}: ${reaches ? "REACHES seed" : "DANGLING"} via ${chain.join(" → ")}`);
  }
}

main().finally(() => prisma.$disconnect());
