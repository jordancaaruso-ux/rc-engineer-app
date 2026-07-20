import { prisma } from "@/lib/prisma";
async function main() {
  const d = await prisma.setupDocument.findUnique({
    where: { id: process.argv[2] ?? "cmrlh9xdr0001jr04ne9axz0s" },
    select: { storagePath: true, originalFilename: true, mimeType: true },
  });
  console.log(JSON.stringify(d, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
