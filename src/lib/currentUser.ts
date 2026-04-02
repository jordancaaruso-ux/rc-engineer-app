import { prisma } from "@/lib/prisma";
import { requireDatabaseUrl } from "@/lib/env";

/**
 * Temporary local-user helper for early app features.
 * Once auth is added, replace this with real session-based user lookup.
 */
export async function getOrCreateLocalUser() {
  requireDatabaseUrl();
  const email = "local@rc.engineer";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;

  return prisma.user.create({ data: { email, name: "Local User" } });
}

