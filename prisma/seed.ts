import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const raw = process.env.AUTH_ALLOWED_EMAILS ?? "";
  const emails = raw
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  for (const email of emails) {
    await prisma.authAllowedEmail.upsert({
      where: { email },
      create: { email },
      update: {},
    });
    console.log("allowlisted:", email);
  }

  if (emails.length === 0) {
    console.log("No AUTH_ALLOWED_EMAILS set — skipped AuthAllowedEmail seed.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
