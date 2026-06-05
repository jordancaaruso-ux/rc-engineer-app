import {
  getSpeedhiveDriverNameForUser,
  getSpeedhiveTransponderNumbersSetting,
} from "@/lib/appSettings";
import { parseSpeedhiveTransponderNumbersSetting } from "@/lib/speedhive/speedhiveTransponder";

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

export async function hasSpeedhiveIdentityForUser(userId: string): Promise<boolean> {
  const [name, transponders] = await Promise.all([
    getSpeedhiveDriverNameForUser(userId),
    getSpeedhiveTransponderNumbersForUser(userId),
  ]);
  return Boolean(name?.trim()) || transponders.length > 0;
}
