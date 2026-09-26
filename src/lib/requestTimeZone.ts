import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { hasDatabaseUrl } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { RC_TIMEZONE_COOKIE, sanitizeIanaTimeZone } from "@/lib/rcTimeZoneCookie";

export { RC_TIMEZONE_COOKIE, sanitizeIanaTimeZone } from "@/lib/rcTimeZoneCookie";

export async function getTimeZoneFromCookies(): Promise<string | null> {
  const jar = await cookies();
  return sanitizeIanaTimeZone(jar.get(RC_TIMEZONE_COOKIE)?.value);
}

/**
 * The signed-in racer's saved zone (`User.timeZone`, mirrored from their devices by
 * `TimeZoneCookieSync`). Null when signed out or never recorded. Once per request.
 */
const signedInUserTimeZone = cache(async function signedInUserTimeZone(): Promise<string | null> {
  if (!hasDatabaseUrl()) return null;
  const id = (await auth())?.user?.id;
  if (!id) return null;
  const row = await prisma.user.findUnique({ where: { id }, select: { timeZone: true } });
  return sanitizeIanaTimeZone(row?.timeZone);
});

/**
 * Zone for formatting run timestamps (and "today") on the server. Prefer the browser cookie.
 *
 * The cookie is written by the page itself, so the first page a new browser opens — often straight
 * from a link — arrives without it. That page used to fall back to UTC: a run logged at 5:05 pm in
 * Sydney read 7:05 am until the next page load (test drive, 2026-09-26). The racer's saved zone is
 * the next best answer; UTC only when there is none, so output stays stable.
 */
export async function getExplicitTimeZoneForRunFormatting(): Promise<string> {
  return (await getTimeZoneFromCookies()) ?? (await signedInUserTimeZone()) ?? "UTC";
}
