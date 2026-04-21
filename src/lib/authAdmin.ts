import "server-only";

/** Comma- or whitespace-separated admin emails (case-insensitive). */
export function parseAuthAdminEmails(): Set<string> {
  const raw = process.env.AUTH_ADMIN_EMAILS?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isAuthAdminEmail(email: string | null | undefined): boolean {
  if (!email?.trim()) return false;
  return parseAuthAdminEmails().has(email.trim().toLowerCase());
}
