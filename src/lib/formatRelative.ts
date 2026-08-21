/**
 * "5 minutes ago", "in 3 days" — the one relative-time voice.
 *
 * Extracted from `RelativeTime` on 2026-08-20 so the SERVER can speak it too. The Teammates
 * card's Last-out band renders its labels server-side and then hands them to `RelativeTime` as
 * the pre-hydration fallback; if the two formatters disagreed, every row would visibly rewrite
 * itself a beat after the page painted — the exact flicker `fallback` exists to prevent.
 *
 * Pure, Prisma-free and clock-injected (`now`), so it is testable and safe inside a cached read.
 */
export function formatRelativeFromNow(then: Date, now: Date): string {
  const diffMs = then.getTime() - now.getTime();
  const absSec = Math.abs(diffMs) / 1000;

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absSec < 45) return diffMs >= 0 ? "in a moment" : "just now";
  if (absSec < 60 * 60) {
    const mins = Math.round(diffMs / 60_000);
    return rtf.format(mins, "minute");
  }
  if (absSec < 60 * 60 * 24) {
    const hrs = Math.round(diffMs / 3_600_000);
    return rtf.format(hrs, "hour");
  }
  if (absSec < 60 * 60 * 24 * 7) {
    const days = Math.round(diffMs / 86_400_000);
    return rtf.format(days, "day");
  }
  if (absSec < 60 * 60 * 24 * 30) {
    const weeks = Math.round(diffMs / (86_400_000 * 7));
    return rtf.format(weeks, "week");
  }
  if (absSec < 60 * 60 * 24 * 365) {
    const months = Math.round(diffMs / (86_400_000 * 30));
    return rtf.format(months, "month");
  }
  const years = Math.round(diffMs / (86_400_000 * 365));
  return rtf.format(years, "year");
}
