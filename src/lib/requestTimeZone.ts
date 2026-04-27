import "server-only";

import { cookies } from "next/headers";
import { RC_TIMEZONE_COOKIE, sanitizeIanaTimeZone } from "@/lib/rcTimeZoneCookie";

export { RC_TIMEZONE_COOKIE, sanitizeIanaTimeZone } from "@/lib/rcTimeZoneCookie";

export async function getTimeZoneFromCookies(): Promise<string | null> {
  const jar = await cookies();
  return sanitizeIanaTimeZone(jar.get(RC_TIMEZONE_COOKIE)?.value);
}

/**
 * Zone for formatting run timestamps on the server. Prefer the browser cookie;
 * fall back to UTC so output is stable when the cookie is not set yet.
 */
export async function getExplicitTimeZoneForRunFormatting(): Promise<string> {
  return (await getTimeZoneFromCookies()) ?? "UTC";
}
