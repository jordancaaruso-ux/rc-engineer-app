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

/** Current-user bridge for routes/pages. Replace with real auth later. */
export async function requireCurrentUser() {
  return getOrCreateLocalUser();
}

/** Convenience helper when only the id is needed. */
export async function requireCurrentUserId(): Promise<string> {
  const u = await requireCurrentUser();
  return u.id;
}

