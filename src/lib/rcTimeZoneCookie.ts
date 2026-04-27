/** Cookie name for browser IANA zone (shared by server formatters + client sync). */
export const RC_TIMEZONE_COOKIE = "rc_tz";

/** Reject tampered cookie values before passing to Intl. */
export function sanitizeIanaTimeZone(raw: string | undefined | null): string | null {
  if (!raw?.trim()) return null;
  const tz = decodeURIComponent(raw.trim());
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz }).format(new Date(0));
    return tz;
  } catch {
    return null;
  }
}
