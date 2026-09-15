/**
 * How the server tells a Capacitor shell from a browser: the shell appends this token to its
 * user agent (`capacitor.config.ts` → `appendUserAgent`). Apple's rule for a subscription app
 * is that the app itself must not sell or link to the subscription, so the join and billing
 * pages show a plan notice inside the shell instead of Stripe — the Netflix pattern.
 */
export const NATIVE_SHELL_UA_TOKEN = "JRCShell/1";

export function isNativeShellUserAgent(userAgent: string | null | undefined): boolean {
  return Boolean(userAgent && userAgent.includes(NATIVE_SHELL_UA_TOKEN));
}
