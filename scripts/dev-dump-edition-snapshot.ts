import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; createdat: Date; email: string }>>(
    `SELECT s.id, s."createdAt" as createdat, u.email
     FROM "SetupSnapshot" s JOIN "User" u ON u.id = s."userId"
     WHERE s.data ? 'front_shock_oil' ORDER BY s."createdAt" ASC`
  );
  console.log(`edition-keyed snapshots here: ${rows.length}`);
  for (const r of rows) console.log(`  ${r.id} ${new Date(r.createdat).toISOString()} ${r.email}`);
  if (rows.length === 0) return;
  const snap = await prisma.setupSnapshot.findUniqueOrThrow({
    where: { id: rows[rows.length - 1]!.id },
    select: { id: true, data: true },
  });
  const data = snap.data as Record<string, unknown>;
  console.log(`\nsnapshot ${snap.id}: ${Object.keys(data).length} keys`);
  for (const [k, v] of Object.entries(data)) {
    console.log(`  ${k} = ${JSON.stringify(v)}`);
  }
}

main().finally(() => prisma.$disconnect());
