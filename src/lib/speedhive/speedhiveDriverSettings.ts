import {
  getLiveRcDriverNameSetting,
  getSpeedhiveDriverNameForUser,
  getSpeedhiveDriverNameSetting,
  getSpeedhiveTransponderNumbersSetting,
} from "@/lib/appSettings";
import { parseSpeedhiveTransponderNumbersSetting } from "@/lib/speedhive/speedhiveTransponder";
import { parseSpeedhiveDriverNamesSetting } from "@/lib/speedhive/speedhiveDriverNames";

export {
  getSpeedhiveDriverNameSetting,
  setSpeedhiveDriverNameSetting,
  getSpeedhiveDriverNameForUser,
  getSpeedhiveTransponderNumbersSetting,
  setSpeedhiveTransponderNumbersSetting,
} from "@/lib/appSettings";

export async function getSpeedhiveTransponderNumbersForUser(userId: string): Promise<number[]> {
  const raw = await getSpeedhiveTransponderNumbersSetting(userId);
  return parseSpeedhiveTransponderNumbersSetting(raw);
}

/**
 * Every name to try against a classification row.
 *
 * The Speedhive list when there is one, otherwise the LiveRC name — same
 * precedence `getSpeedhiveDriverNameForUser` has always applied, just widened
 * to a set. An old single-name value parses to a one-element list, so nothing
 * saved before this needs migrating.
 */
export async function getSpeedhiveDriverNamesForUser(userId: string): Promise<string[]> {
  const speedhive = parseSpeedhiveDriverNamesSetting(await getSpeedhiveDriverNameSetting(userId));
  if (speedhive.length > 0) return speedhive;
  const liveRc = (await getLiveRcDriverNameSetting(userId))?.trim();
  return liveRc ? [liveRc] : [];
}

export async function hasSpeedhiveIdentityForUser(userId: string): Promise<boolean> {
  const [names, transponders] = await Promise.all([
    getSpeedhiveDriverNamesForUser(userId),
    getSpeedhiveTransponderNumbersForUser(userId),
  ]);
  return names.length > 0 || transponders.length > 0;
}
