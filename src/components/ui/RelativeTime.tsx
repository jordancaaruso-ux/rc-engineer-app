"use client";

import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  RUN_DATETIME_LOCALE,
  RUN_DISPLAY_DATETIME_OPTIONS,
  calendarDayDifference,
  formatRunCreatedAtDateTime,
  formatRunDateOnly,
} from "@/lib/formatDate";
import { formatRelativeFromNow } from "@/lib/formatRelative";

function formatLocalExact(d: Date): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Intl.DateTimeFormat(RUN_DATETIME_LOCALE, {
    ...RUN_DISPLAY_DATETIME_OPTIONS,
    timeZone,
  }).format(d);
}

function capitalizeFirst(s: string): string {
  return s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}` : s;
}

/**
 * Render a timestamp in the user's local timezone.
 *
 * SSR renders `fallback` (keeps hydration stable, even if the server clock is
 * UTC). After mount the component switches to the requested `display`:
 *   - `relative` → "5 minutes ago", with the exact local time on hover.
 *   - `exact`    → local date + time (12h), with ISO on hover.
 *   - `combo`    → "5 minutes ago · 07:42 pm" (2-digit hour, device time zone).
 *   - `sessions` → relative only when within 3 calendar days of today (in
 *     `timeZone` when set); otherwise date-only (no time). Exact datetime on hover.
 *
 * Relative mode re-ticks every 30 s so "just now" updates.
 */
export function RelativeTime({
  iso,
  fallback,
  display = "relative",
  className,
  timeZone,
}: {
  iso: string | Date | null | undefined;
  /** Server-safe initial label. Used during SSR and the first client render. */
  fallback: string;
  display?: "relative" | "exact" | "combo" | "sessions";
  className?: string;
  /** IANA zone for `sessions` date-only labels and calendar-day cutoff (optional). */
  timeZone?: string | null;
}) {
  const resolvedClassName = cn("type-timestamp", className);
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    setMounted(true);
    if (display === "exact") return;
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, [display]);

  if (!iso) return <span className={resolvedClassName}>{fallback}</span>;

  const dt = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(dt.getTime())) {
    return <span className={resolvedClassName}>{fallback}</span>;
  }

  if (!mounted) {
    return (
      <span className={resolvedClassName} suppressHydrationWarning>
        {fallback}
      </span>
    );
  }

  const exact = formatLocalExact(dt);
  const relative = formatRelativeFromNow(dt, now);

  if (display === "exact") {
    return (
      <span className={resolvedClassName} title={dt.toISOString()}>
        {exact}
      </span>
    );
  }
  if (display === "combo") {
    return (
      <span className={resolvedClassName} title={dt.toISOString()}>
        {relative} · {exact}
      </span>
    );
  }
  if (display === "sessions") {
    const dayDiff = Math.abs(calendarDayDifference(dt, now, timeZone));
    const label =
      dayDiff <= 3 ? capitalizeFirst(relative) : formatRunDateOnly(dt, timeZone ?? undefined);
    const titleExact =
      timeZone != null && String(timeZone).trim()
        ? formatRunCreatedAtDateTime(dt, timeZone)
        : exact;
    return (
      <span className={resolvedClassName} title={titleExact}>
        {label}
      </span>
    );
  }
  return (
    <span className={resolvedClassName} title={exact}>
      {relative}
    </span>
  );
}
