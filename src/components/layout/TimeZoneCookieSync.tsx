"use client";

import { useEffect } from "react";
import { RC_TIMEZONE_COOKIE } from "@/lib/rcTimeZoneCookie";

/** Once per tab: the account-zone POST is a repair, not a heartbeat. */
const SYNCED_FLAG = "rc_tz_synced";

/**
 * Keeps `rc_tz` aligned with the device IANA zone so server-rendered run
 * timestamps can use the same zone as the browser (see getTimeZoneFromCookies),
 * and mirrors that zone onto the account.
 *
 * The account write matters for OTHER people reading your runs. Which calendar
 * day a run belongs to resolves run → owner → viewer, and runs logged before
 * 2026-08-09 carry no zone of their own — so without `User.timeZone` your
 * sessions are dated in whatever zone your teammate happens to be sitting in,
 * which is what split one continuous test day across two dates. Creating a run
 * used to be the only thing that set it; that never fires for a driver who is
 * only being read.
 */
export function TimeZoneCookieSync() {
  useEffect(() => {
    let tz: string;
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      document.cookie = `${RC_TIMEZONE_COOKIE}=${encodeURIComponent(tz)};path=/;max-age=31536000;SameSite=Lax`;
    } catch {
      return;
    }
    if (!tz) return;

    // Session-scoped so a long-lived tab doesn't re-post on every navigation.
    // Best-effort throughout: signed-out visitors get a 401 and demo accounts a
    // 403 from the read-only gate, and neither is worth surfacing — the zone is
    // an optimisation for how other people read your dates, not something the
    // page depends on.
    try {
      if (sessionStorage.getItem(SYNCED_FLAG) === tz) return;
    } catch {
      // Private-mode storage refusal: fall through and just post.
    }
    void fetch("/api/me/time-zone", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timeZone: tz }),
      keepalive: true,
    })
      .then((r) => {
        if (!r.ok) return;
        try {
          sessionStorage.setItem(SYNCED_FLAG, tz);
        } catch {
          // ignore
        }
      })
      .catch(() => {
        // ignore
      });
  }, []);
  return null;
}
