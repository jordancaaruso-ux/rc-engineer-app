import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const model = await prisma.setupSheetModel.findFirstOrThrow({
    where: { slug: "awesomatix_a800rr" },
    select: { schemaJson: true },
  });
  const schema = model.schemaJson as { fields: Array<Record<string, unknown>> };
  for (const f of schema.fields) {
    if (f.key === "chassis" || f.key === "chassis_other") {
      console.log(JSON.stringify(f, null, 2));
    }
  }
}

main().finally(() => prisma.$disconnect());
