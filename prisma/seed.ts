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

  const pilotRaw = process.env.TEAM_PILOT_MEMBER_EMAILS ?? "";
  const pilotEmails = pilotRaw
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const pilotName = (process.env.TEAM_PILOT_NAME ?? "Pilot team").trim() || "Pilot team";

  if (pilotEmails.length >= 2) {
    const users = await prisma.user.findMany({
      where: { email: { in: pilotEmails } },
      select: { id: true, email: true },
    });
    if (users.length < 2) {
      console.warn(
        "TEAM_PILOT_MEMBER_EMAILS needs at least two existing User rows — found",
        users.length,
        "— skipped Team seed."
      );
    } else {
      const existing = await prisma.team.findFirst({
        where: { name: pilotName },
        select: { id: true },
      });
      if (existing) {
        console.log("pilot team name already exists — skipped Team create:", pilotName);
      } else {
        const team = await prisma.team.create({
          data: {
            name: pilotName,
            createdByUserId: users[0]!.id,
            memberships: {
              create: users.map((u) => ({ userId: u.id, role: "member" })),
            },
          },
          select: { id: true, name: true },
        });
        console.log("pilot team:", team.id, team.name, "members:", users.map((u) => u.email).join(", "));
      }
    }
  } else if (pilotRaw.trim()) {
    console.warn("TEAM_PILOT_MEMBER_EMAILS must list at least two comma-separated emails — skipped Team seed.");
  } else {
    console.log("No TEAM_PILOT_MEMBER_EMAILS — skipped Team pilot seed.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
