import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
async function main() {
  const r = await prisma.setupSnapshot.findUnique({
    where: { id: process.argv[2]! },
    select: { setupPdfRenderVersion: true, renderedSetupPdfPath: true },
  });
  console.log(JSON.stringify(r));
}
main().finally(() => prisma.$disconnect());
