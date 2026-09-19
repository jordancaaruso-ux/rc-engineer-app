import { PrismaClient } from "@prisma/client";
async function main() {
  const prisma = new PrismaClient();
  const since = new Date(Date.now() - 14 * 60 * 1000);
  const rows = await prisma.engineerChatMessage.findMany({
    where: { role: "assistant", createdAt: { gte: since }, content: { contains: "shim", mode: "insensitive" } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, content: true },
  });
  for (const r of rows) {
    const sents = r.content.split(/(?<=[.!?])\s+|\n/).filter((s) => /shim|roll centre|pickup/i.test(s));
    for (const s of sents) console.log(r.createdAt.toISOString().slice(5, 16), "|", s.replace(/\s+/g, " ").slice(0, 170));
  }
  console.log("messages:", rows.length);
  await prisma.$disconnect();
}
main();
