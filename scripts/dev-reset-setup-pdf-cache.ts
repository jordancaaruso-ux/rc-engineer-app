import { PrismaClient } from "@prisma/client";

/** Dev rig: forget a snapshot's rendered PDF so the next request re-makes it. */
const prisma = new PrismaClient();
async function main() {
  const r = await prisma.setupSnapshot.update({
    where: { id: process.argv[2]! },
    data: { setupPdfRenderVersion: 0 },
    select: { id: true, setupPdfRenderVersion: true },
  });
  console.log(JSON.stringify(r));
}
main().finally(() => prisma.$disconnect());
