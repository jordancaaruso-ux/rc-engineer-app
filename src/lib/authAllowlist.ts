import { prisma } from "@/lib/prisma";
import { parseEmailSetFromEnv } from "@/lib/authEmailSets";
import { isOpenSignupEnabled } from "@/lib/authOpenSignup";
import { isAppReviewerEmail } from "@/lib/auth/appReviewer";

/** Comma- or whitespace-separated list in env (case-insensitive). */
export function parseEnvAuthAllowlist(): Set<string> {
  return parseEmailSetFromEnv(process.env.AUTH_ALLOWED_EMAILS);
}

/**
 * A hard door for a deployment that is not the main site: when `AUTH_ONLY_EMAILS` is set, only
 * those addresses may sign in here, whatever the rules below say. beta.jrcdynamics.com shares
 * production's database, so without this every customer could sign in to the beta.
 */
export function parseAuthOnlyEmails(): Set<string> {
  return parseEmailSetFromEnv(process.env.AUTH_ONLY_EMAILS);
}

/**
 * Who may request or complete magic-link sign-in.
 * - `AUTH_ONLY_EMAILS` (when set) is the door to THIS deployment — checked before everything.
 * - `AUTH_OPEN_SIGNUP=1` allows any well-formed address (open public signup — see below).
 * - `AUTH_DEV_ALLOW_ANY_EMAIL=1` in non-production allows any address (local dev only).
 * - `AUTH_ALLOWED_EMAILS` env list (comma-separated).
 * - `AuthAllowedEmail` rows in the database (invite list).
 * - Any account that already exists — payers, and the app's own sign-ups (see below).
 */
export async function isEmailAuthAllowed(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const only = parseAuthOnlyEmails();
  if (only.size > 0 && !only.has(normalized)) return false;
  // Apple's reviewer, even after they have tested Delete account (`lib/auth/appReviewer.ts`).
  if (isAppReviewerEmail(normalized)) return true;
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
  // An account that exists may sign in; entitlement, not sign-in, decides what it can use. Neither
  // way in writes an allowlist row, because an allowlist row reads as an invite:
  //   - the paid door (MONETISATION_NORTH_STAR.md): the webhook creates the payer's account, and a
  //     lapsed payer must still reach /billing to renew;
  //   - the iPhone app's sign-up (2026-09-24, `/api/auth/app-signup`): the account is created
  //     unpaid, and its owner has to be able to come back to it and sign in again.
  // Nothing on the website creates an account for a stranger, so an unknown address is still
  // turned away there.
  const account = await prisma.user.findFirst({
    where: { email: normalized },
    select: { id: true },
  });
  return account != null;
}
