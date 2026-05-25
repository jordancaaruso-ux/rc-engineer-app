import { prisma } from "@/lib/prisma";
import { parseEmailSetFromEnv } from "@/lib/authEmailSets";

/** Comma- or whitespace-separated list in env (case-insensitive). */
export function parseEnvAuthAllowlist(): Set<string> {
  return parseEmailSetFromEnv(process.env.AUTH_ALLOWED_EMAILS);
}

/**
 * Who may request or complete magic-link sign-in.
 * - `AUTH_DEV_ALLOW_ANY_EMAIL=1` in non-production allows any address (local dev only).
 * - `AUTH_ALLOWED_EMAILS` env list (comma-separated).
 * - `AuthAllowedEmail` rows in the database (invite list).
 */
export async function isEmailAuthAllowed(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  if (process.env.NODE_ENV !== "production" && process.env.AUTH_DEV_ALLOW_ANY_EMAIL === "1") {
    return true;
  }
  if (parseEnvAuthAllowlist().has(normalized)) return true;
  const row = await prisma.authAllowedEmail.findUnique({
    where: { email: normalized },
  });
  return row != null;
}
