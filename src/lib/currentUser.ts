import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireDatabaseUrl } from "@/lib/env";
import type { User } from "@prisma/client";

/**
 * Authenticated user for Route Handlers — returns null with no redirect (use 401 JSON).
 */
export async function getAuthenticatedApiUser(): Promise<User | null> {
  requireDatabaseUrl();
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return prisma.user.findUnique({ where: { id } });
}

/**
 * Server Components / server actions — redirect to login if missing session.
 */
export async function requireCurrentUser(): Promise<User> {
  requireDatabaseUrl();
  const session = await auth();
  const id = session?.user?.id;
  if (!id) {
    redirect("/login");
  }
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    redirect("/login");
  }
  return user;
}

/** Convenience when only the id is needed (RSC). */
export async function requireCurrentUserId(): Promise<string> {
  return (await requireCurrentUser()).id;
}
