import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { APP_SETTING_KEYS, getUserSetting, setUserSetting } from "@/lib/appSettings";
import { unitSystemTag } from "@/lib/cacheTags";
import { getTimeZoneFromCookies } from "@/lib/requestTimeZone";
import {
  defaultUnitSystemForTimeZone,
  parseUnitSystem,
  resolveUnitSystem,
  type UnitSystem,
} from "@/lib/units/unitSystem";

const IMMEDIATE = { expire: 0 } as const;

/*
 * Cached per driver because the root layout reads it on every page load, and an uncached
 * setting read there would sit in front of first paint on every page (a row read measured
 * ~14 ms). Both writers below drop the tag; the hour is only a backstop.
 */
function storedUnitSystem(userId: string): Promise<UnitSystem | null> {
  return unstable_cache(
    async () => parseUnitSystem(await getUserSetting(userId, APP_SETTING_KEYS.unitSystem)),
    [`unit-system-v1-${userId}`],
    { tags: [unitSystemTag(userId)], revalidate: 3600 }
  )();
}

/**
 * The unit a page or API request answers in: the driver's stored choice, else the default for
 * the device's zone (the `rc_tz` cookie, which the bootstrap script writes before any request
 * that carries a session). Signed-out pages get the zone default. A failed read falls back to
 * the zone rather than failing the page: a wrong unit is labelled, a 500 is not.
 */
export async function unitSystemForRequest(userId: string | null | undefined): Promise<UnitSystem> {
  const zone = await getTimeZoneFromCookies();
  if (!userId) return defaultUnitSystemForTimeZone(zone);
  try {
    return resolveUnitSystem(await storedUnitSystem(userId), zone);
  } catch (err) {
    console.warn("[units] could not read the stored unit system; using the zone default", err);
    return defaultUnitSystemForTimeZone(zone);
  }
}

/**
 * The unit for a driver when no device is asking: the evening summary, sent from a cron. The
 * stored choice, else the zone the account last reported. Uncached on purpose: it runs once per
 * driver per evening, outside any page.
 */
export async function unitSystemForUser(
  userId: string,
  knownTimeZone?: string | null
): Promise<UnitSystem> {
  const stored = parseUnitSystem(await getUserSetting(userId, APP_SETTING_KEYS.unitSystem));
  if (stored) return stored;
  const zone =
    knownTimeZone !== undefined
      ? knownTimeZone
      : ((await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } }))
          ?.timeZone ?? null);
  return defaultUnitSystemForTimeZone(zone);
}

/** The Settings switch. */
export async function saveUnitSystem(userId: string, units: UnitSystem): Promise<void> {
  await setUserSetting(userId, APP_SETTING_KEYS.unitSystem, units);
  revalidateTag(unitSystemTag(userId), IMMEDIATE);
}

/**
 * The first time a device reports its zone, the default for that zone becomes the driver's
 * stored unit, so it stops following the device: an American at a race in Europe keeps °F.
 * Never overwrites a stored value, the switch's included. One insert that does nothing when a
 * row exists, so the once-a-visit zone report stays one cheap query.
 */
export async function stampDefaultUnitSystem(userId: string, timeZone: string): Promise<void> {
  const { count } = await prisma.appSetting.createMany({
    data: [
      {
        userId,
        key: APP_SETTING_KEYS.unitSystem,
        value: defaultUnitSystemForTimeZone(timeZone),
      },
    ],
    skipDuplicates: true,
  });
  if (count > 0) revalidateTag(unitSystemTag(userId), IMMEDIATE);
}
