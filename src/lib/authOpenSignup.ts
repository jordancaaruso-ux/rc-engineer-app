/**
 * Open public signup.
 *
 * When `AUTH_OPEN_SIGNUP=1`, anyone with a well-formed email may sign in (Google or magic link)
 * and gets a `User` created on first sign-in — the allowlist / access-code gate is bypassed.
 * Unset (the default) restores invite-only behaviour byte-for-byte.
 *
 * Deliberately prisma-free and env-only so it's safe to import anywhere, including the edge
 * `config-hint` surface, without pulling the database client into that bundle.
 */
export function isOpenSignupEnabled(): boolean {
  return process.env.AUTH_OPEN_SIGNUP === "1";
}
