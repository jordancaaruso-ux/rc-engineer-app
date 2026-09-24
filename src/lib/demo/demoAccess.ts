/**
 * Pure demo-mode access logic — NO database, NO `server-only`, NO Next imports. Safe to
 * unit-test (`npm run test:demo`) and to import from the EDGE middleware (no Prisma in the
 * graph). The DB-touching pieces (sign-in route, seed) live elsewhere.
 *
 * Model (MONETISATION_NORTH_STAR.md Phase 3): one shared demo account, seeded from the
 * founder's real season. Visitors browse everything and write nothing — every write is refused
 * centrally in middleware, with no exceptions since 2026-08-25 (see the allowlist below).
 */

/** Fixed id of the shared demo account — mirrors the default in scripts/seed-demo-account.ts. */
export const DEMO_USER_ID_FALLBACK = "demo0000000000000000user1";

/**
 * Writes a demo session may still perform. Empty — the demo is read-only, full stop.
 *
 * `/api/engineer/chat` lived here until 2026-08-25, letting a visitor ask two live questions.
 * Founder call retired it: the demo does not need to ANSWER questions, it needs a really good
 * record of questions it has already answered. Simpler product and a strictly better one to
 * operate — no per-IP throttle to leak on serverless, no global spend ceiling, no way for a
 * launch-day crowd to make the Engineer go dark for everyone who arrives after them, and no
 * anonymous path to an LLM bill at all.
 *
 * Kept as a Set rather than folded away: the shape of the decision below is the valuable part,
 * and re-opening a single path is a one-line change if that call is ever reversed.
 */
const DEMO_WRITE_ALLOWLIST = new Set<string>();

/** Methods that never mutate — always allowed for demo sessions. */
const READ_METHODS = new Set<string>(["GET", "HEAD", "OPTIONS"]);

export type DemoEnv = { DEMO_USER_ID?: string; DEMO_USER_EMAIL?: string };

/**
 * Is this identity the shared demo account? Unset env ⇒ never demo (the whole feature is
 * dark until the seed exists and the envs are set). Email compare is case-insensitive.
 */
export function isDemoIdentity(
  identity: { id?: string | null; email?: string | null },
  env: DemoEnv = process.env as DemoEnv,
): boolean {
  const demoId = env.DEMO_USER_ID?.trim();
  const demoEmail = env.DEMO_USER_EMAIL?.trim().toLowerCase();
  if (demoId && identity.id === demoId) return true;
  if (demoEmail && identity.email?.trim().toLowerCase() === demoEmail) return true;
  return false;
}

/**
 * The demo account's id for **catalog scoping**. Unlike `isDemoIdentity`, this never goes dark
 * when the env is unset: the seed writes its rows under the fixed id either way, and those rows
 * must never join the community catalog even on a box that has not set DEMO_USER_ID.
 */
export function demoCatalogUserId(env: DemoEnv = process.env as DemoEnv): string {
  return env.DEMO_USER_ID?.trim() || DEMO_USER_ID_FALLBACK;
}

/**
 * Is this the shared demo account, for anything that must never treat it as a real driver? The
 * configured identity OR the seed's fixed id, so it never goes dark either.
 *
 * - Billing: nothing may be bought onto it. A visitor who paid while still carrying the demo's
 *   session had the plan land there (2026-09-24 audit) — no account of their own, no sign-in
 *   code, and the demo's plan overwritten for everyone after.
 * - Background timing-site reads: every visitor is the same account, so a launch-day crowd
 *   opening its dashboard would read LiveRC on the demo's behalf over and over.
 */
export function isSharedDemoAccount(
  identity: { id?: string | null; email?: string | null },
  env: DemoEnv = process.env as DemoEnv,
): boolean {
  if (isDemoIdentity(identity, env)) return true;
  return Boolean(identity.id) && identity.id === demoCatalogUserId(env);
}

/**
 * Central read-only decision for a demo session's request. Non-demo sessions never reach
 * this. Page-path POSTs (server actions) are forbidden too — the one server action in the
 * app is founder tooling anyway.
 */
export function decideDemoRequest(input: {
  method: string;
  pathname: string;
}): "allow" | "forbid" {
  if (READ_METHODS.has(input.method.toUpperCase())) return "allow";
  if (DEMO_WRITE_ALLOWLIST.has(input.pathname)) return "allow";
  return "forbid";
}

/** The message every refused write carries — quiet, never aggressive (founder 2026-08-02).
 *  The selling happens in the banner; the refusal just states the fact. */
export const DEMO_READ_ONLY_MESSAGE = "The demo is read-only.";

