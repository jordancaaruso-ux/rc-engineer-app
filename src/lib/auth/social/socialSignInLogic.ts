/**
 * Sign in with Apple / Google: which Trackside account a verified identity opens.
 *
 * ============================== THE RULE ==============================
 *
 * Nobody gets a second account by accident (founder, 2026-09-25: "no one should end up with two
 * accounts — that seems like a horrible flaw"). So an identity opens an account only when it can be
 * tied to one for certain:
 *
 *   1. It is already linked (an `Account` row for this provider + `sub`) → that account.
 *   2. Its email is verified by Apple/Google and an account has exactly that email → that account,
 *      and the identity is linked to it so rule 1 answers next time.
 *   3. Anything else — a Hide My Email relay address, or a Google address that isn't the one the
 *      driver signed up with — makes NO account on its own. The driver is asked whether they are
 *      new or already have an account (`/login/connect`); "already have one" signs in once by email
 *      code and links the identity there.
 *
 * Pure (no database, no `server-only`), so the rule is tested directly.
 */

export type SocialProvider = "apple" | "google";

export type SocialIdentity = {
  provider: SocialProvider;
  /** The provider's stable id for this person (`sub`). Apple's is the same in the app and on the
   * website because the website's Services ID is grouped under the app's primary App ID. */
  sub: string;
  email: string | null;
  emailVerified: boolean;
  /** Apple's Hide My Email: a relay address that forwards to the driver's real inbox. */
  isPrivateEmail: boolean;
  name: string | null;
  image: string | null;
};

export type AccountRef = { id: string; email: string | null };

export type SocialDecision =
  | { kind: "sign-in"; user: AccountRef; link: boolean }
  | { kind: "choose" };

export function decideSocialSignIn(input: {
  /** The account this provider + `sub` is already linked to, if any. */
  linked: AccountRef | null;
  /** The account whose email equals the identity's email, if any. */
  byEmail: AccountRef | null;
  emailVerified: boolean;
}): SocialDecision {
  if (input.linked) return { kind: "sign-in", user: input.linked, link: false };
  // An unverified address proves nothing about who owns the account that carries it.
  if (input.byEmail && input.emailVerified) {
    return { kind: "sign-in", user: input.byEmail, link: true };
  }
  return { kind: "choose" };
}

/** Apple sends some booleans as the strings "true" / "false". */
export function claimIsTrue(value: unknown): boolean {
  return value === true || value === "true";
}

export function normalizeIdentityEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return email.includes("@") && !/\s/.test(email) ? email : null;
}

/** The identity inside a token whose signature, issuer, audience, expiry and nonce were checked. */
export function identityFromClaims(
  provider: SocialProvider,
  claims: Record<string, unknown>,
): SocialIdentity | null {
  const sub = typeof claims.sub === "string" && claims.sub ? claims.sub : null;
  if (!sub) return null;
  const email = normalizeIdentityEmail(claims.email);
  const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : null;
  const image =
    typeof claims.picture === "string" && claims.picture.startsWith("https://")
      ? claims.picture
      : null;
  return {
    provider,
    sub,
    email,
    emailVerified: email !== null && claimIsTrue(claims.email_verified),
    isPrivateEmail: provider === "apple" && claimIsTrue(claims.is_private_email),
    name,
    image,
  };
}

/** Apple sends the name once, beside the token (never inside it), on the first sign-in only. */
export function joinName(given: unknown, family: unknown): string | null {
  const parts = [given, family]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/** A same-origin path to land on after signing in; anything else lands on the dashboard. */
export function safeCallbackPath(raw: unknown): string {
  return typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

export function providerLabel(provider: SocialProvider): "Apple" | "Google" {
  return provider === "apple" ? "Apple" : "Google";
}

/** Where "I already have an account" sends the driver, and where that sign-in comes back to. */
export const FINISH_LINK_PATH = "/api/auth/social/finish";

export function connectSignInPath(provider: SocialProvider): string {
  return `/login?${new URLSearchParams({ connect: provider, from: FINISH_LINK_PATH })}`;
}
