import { prisma } from "@/lib/prisma";
import { parseEmailSetFromEnv } from "@/lib/authEmailSets";
import { isOpenSignupEnabled } from "@/lib/authOpenSignup";

/** Comma- or whitespace-separated list in env (case-insensitive). */
export function parseEnvAuthAllowlist(): Set<string> {
  return parseEmailSetFromEnv(process.env.AUTH_ALLOWED_EMAILS);
}

/**
 * Who may request or complete magic-link sign-in.
 * - `AUTH_OPEN_SIGNUP=1` allows any well-formed address (open public signup — see below).
 * - `AUTH_DEV_ALLOW_ANY_EMAIL=1` in non-production allows any address (local dev only).
 * - `AUTH_ALLOWED_EMAILS` env list (comma-separated).
 * - `AuthAllowedEmail` rows in the database (invite list).
 * - Paying customers: any account with a `Subscription` row (the paid door — see below).
 */
export async function isEmailAuthAllowed(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  // Open public signup: any well-formed address is allowed, so the PrismaAdapter creates the
  // account on first sign-in. This is the single pivot — both gates in `auth.ts`
  // (`sendVerificationRequest` + the `signIn` callback) call this one function. Unset = the
  // invite-only checks below, unchanged.
  if (isOpenSignupEnabled()) return true;
  if (process.env.NODE_ENV !== "production" && process.env.AUTH_DEV_ALLOW_ANY_EMAIL === "1") {
    return true;
  }
  if (parseEnvAuthAllowlist().has(normalized)) return true;
  const row = await prisma.authAllowedEmail.findUnique({
    where: { email: normalized },
  });
  if (row != null) return true;
  // The paid door (MONETISATION_NORTH_STAR.md): payers deliberately get NO allowlist row —
  // `isGrandfatheredEmail` (entitlement.ts) reads every row as free-Pro-forever, which would
  // outlive their subscription. Any Subscription row grants sign-in whatever its status: a lapsed
  // payer must still reach /billing to renew. Entitlement, not sign-in, decides what they can use.
  const payer = await prisma.user.findFirst({
    where: { email: normalized, subscription: { isNot: null } },
    select: { id: true },
  });
  return payer != null;
}
