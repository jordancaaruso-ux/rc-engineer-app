import { prisma } from "@/lib/prisma";
import { requireDatabaseUrl } from "@/lib/env";

/**
 * Temporary local-user helper for early app features.
 * Once auth is added, replace this with real session-based user lookup.
 */
export async function getOrCreateLocalUser() {
  requireDatabaseUrl();
  const existing = await prisma.user.findFirst();
  if (existing) return existing;

  return prisma.user.create({
    data: {
      email: "local@rc.engineer",
      name: "Local User"
    }
  });
}

