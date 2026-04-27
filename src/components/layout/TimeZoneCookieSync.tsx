"use client";

import { useEffect } from "react";
import { RC_TIMEZONE_COOKIE } from "@/lib/rcTimeZoneCookie";

/**
 * Keeps `rc_tz` aligned with the device IANA zone so server-rendered run
 * timestamps can use the same zone as the browser (see getTimeZoneFromCookies).
 */
export function TimeZoneCookieSync() {
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      document.cookie = `${RC_TIMEZONE_COOKIE}=${encodeURIComponent(tz)};path=/;max-age=31536000;SameSite=Lax`;
    } catch {
      // ignore
    }
  }, []);
  return null;
}
