/**
 * Reports whether legacy single-user rows still exist (local@rc.engineer).
 * Run: npx tsx scripts/check-legacy-local-user.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const legacy = await prisma.user.findUnique({
    where: { email: "local@rc.engineer" },
    select: { id: true, email: true, createdAt: true },
  });
  if (!legacy) {
    console.log("OK: no User with email local@rc.engineer");
    return;
  }
  console.log("Found legacy user row:", legacy);
  console.log("See docs/MIGRATION_SINGLE_USER.md to reassign email or wipe.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
