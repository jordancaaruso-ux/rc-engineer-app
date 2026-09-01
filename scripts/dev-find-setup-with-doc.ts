import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Dev rig: a setup page URL that has an uploaded file behind it, for driving the action row. */
async function main() {
  const rows = await prisma.setupSnapshot.findMany({
    where: { sourceDocuments: { some: {} }, carId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      carId: true,
      name: true,
      isLibrary: true,
      user: { select: { email: true } },
      runs: { select: { id: true }, take: 1 },
    },
  });
  for (const r of rows) {
    console.log(
      `${r.user?.email ?? "?"} | library=${r.isLibrary} | run=${r.runs[0]?.id ?? "-"} | /cars/${r.carId}/setups/${r.id}`
    );
  }
}

main().finally(() => prisma.$disconnect());
