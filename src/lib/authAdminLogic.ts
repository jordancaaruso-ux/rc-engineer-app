import { parseEmailSetFromEnv } from "@/lib/authEmailSets";

/** Comma- or whitespace-separated admin emails (case-insensitive). */
export function parseAuthAdminEmails(): Set<string> {
  return parseEmailSetFromEnv(process.env.AUTH_ADMIN_EMAILS);
}

export function isAuthAdminEmail(email: string | null | undefined): boolean {
  if (!email?.trim()) return false;
  return parseAuthAdminEmails().has(email.trim().toLowerCase());
}
