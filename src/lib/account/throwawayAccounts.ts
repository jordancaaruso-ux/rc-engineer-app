/**
 * Disposable onboarding-test accounts — the `+ob…` aliases `scripts/dev-fresh-onboarding.ts`
 * mints so the first-run flow can be walked as a genuinely new user.
 *
 * They are real User rows doing real writes, which is the whole point — and also the problem:
 * a track added during a walkthrough joins the one global catalog and stays there after the
 * walkthrough ends, so every later session sees it (three "Ridge Raceway <nnn>" rows from the
 * 2026-08-05 runs are what surfaced this). Same shape as the demo account, different cause:
 * not a real member of the community catalog, so kept out of it. See `communityTrackAccess.ts`.
 *
 * Pure — no Prisma, no `server-only`. The script imports these constants too, so the pattern
 * that creates the aliases and the pattern that hides them cannot drift apart.
 */

/** Base address the throwaway aliases are built from. Any inbox works; none is ever emailed. */
export const THROWAWAY_BASE_EMAIL = "jordancaaruso@gmail.com";

/** Sub-address tag that marks an alias disposable: `jordancaaruso+ob0805-7d13@gmail.com`. */
export const THROWAWAY_EMAIL_TAG = "+ob";

const [BASE_LOCAL, BASE_DOMAIN] = THROWAWAY_BASE_EMAIL.split("@");

/** `jordancaaruso+ob` — the prefix every throwaway alias starts with. */
export const THROWAWAY_EMAIL_PREFIX = `${BASE_LOCAL}${THROWAWAY_EMAIL_TAG}`;

/** `@gmail.com` — the suffix every throwaway alias ends with. */
export const THROWAWAY_EMAIL_SUFFIX = `@${BASE_DOMAIN}`;

/**
 * Prisma string filter matching exactly the throwaway aliases. Both ends are required so a real
 * address that merely contains `+ob` (or a lookalike on another domain) is never caught.
 */
export function throwawayEmailWhere(): {
  startsWith: string;
  endsWith: string;
  mode: "insensitive";
} {
  return {
    startsWith: THROWAWAY_EMAIL_PREFIX,
    endsWith: THROWAWAY_EMAIL_SUFFIX,
    mode: "insensitive",
  };
}

/** Same rule in plain TS, for callers holding an email rather than building a query. */
export function isThrowawayEmail(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.startsWith(THROWAWAY_EMAIL_PREFIX.toLowerCase()) &&
    normalized.endsWith(THROWAWAY_EMAIL_SUFFIX.toLowerCase())
  );
}
