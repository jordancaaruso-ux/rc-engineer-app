"use client";

import React, { useEffect, useState } from "react";
import {
  RUN_DATETIME_LOCALE,
  RUN_DISPLAY_DATETIME_OPTIONS,
} from "@/lib/formatDate";

function formatLocalExact(d: Date): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Intl.DateTimeFormat(RUN_DATETIME_LOCALE, {
    ...RUN_DISPLAY_DATETIME_OPTIONS,
    timeZone,
  }).format(d);
}

function formatRelative(then: Date, now: Date): string {
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

/**
 * Render a timestamp in the user's local timezone.
 *
 * SSR renders `fallback` (keeps hydration stable, even if the server clock is
 * UTC). After mount the component switches to the requested `display`:
 *   - `relative` → "5 minutes ago", with the exact local time on hover.
 *   - `exact`    → local date + time (12h), with ISO on hover.
 *   - `combo`    → "5 minutes ago · 07:42 pm" (2-digit hour, device time zone).
 *
 * Relative mode re-ticks every 30 s so "just now" updates.
 */
export function RelativeTime({
  iso,
  fallback,
  display = "relative",
  className,
}: {
  iso: string | Date | null | undefined;
  /** Server-safe initial label. Used during SSR and the first client render. */
  fallback: string;
  display?: "relative" | "exact" | "combo";
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    setMounted(true);
    if (display === "exact") return;
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, [display]);

  if (!iso) return <span className={className}>{fallback}</span>;

  const dt = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(dt.getTime())) {
    return <span className={className}>{fallback}</span>;
  }

  if (!mounted) {
    return (
      <span className={className} suppressHydrationWarning>
        {fallback}
      </span>
    );
  }

  const exact = formatLocalExact(dt);
  const relative = formatRelative(dt, now);

  if (display === "exact") {
    return (
      <span className={className} title={dt.toISOString()}>
        {exact}
      </span>
    );
  }
  if (display === "combo") {
    return (
      <span className={className} title={dt.toISOString()}>
        {relative} · {exact}
      </span>
    );
  }
  return (
    <span className={className} title={exact}>
      {relative}
    </span>
  );
}
