import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const APP_SETTING_KEYS = {
  myName: "myName",
} as const;

export type AppSettingKey = (typeof APP_SETTING_KEYS)[keyof typeof APP_SETTING_KEYS];

function isMissingAppSettingTableError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021") {
    return true;
  }
  if (err instanceof Error) {
    return /AppSetting/i.test(err.message) && /does not exist|no such table/i.test(err.message);
  }
  return false;
}

export async function getUserSetting(userId: string, key: AppSettingKey): Promise<string | null> {
  try {
    const row = await prisma.appSetting.findUnique({
      where: { userId_key: { userId, key } },
      select: { value: true },
    });
    return row?.value ?? null;
  } catch (err) {
    if (isMissingAppSettingTableError(err)) {
      console.warn("[appSettings] AppSetting table missing; returning null");
      return null;
    }
    throw err;
  }
}

export async function setUserSetting(userId: string, key: AppSettingKey, value: string | null): Promise<void> {
  const next = value?.trim() ?? "";
  try {
    if (!next) {
      await prisma.appSetting.deleteMany({ where: { userId, key } });
      return;
    }

    await prisma.appSetting.upsert({
      where: { userId_key: { userId, key } },
      create: { userId, key, value: next },
      update: { value: next },
    });
  } catch (err) {
    if (isMissingAppSettingTableError(err)) {
      console.warn("[appSettings] AppSetting table missing; skipping write");
      return;
    }
    throw err;
  }
}

export async function getMyNameSetting(userId: string): Promise<string | null> {
  return getUserSetting(userId, APP_SETTING_KEYS.myName);
}

export async function setMyNameSetting(userId: string, value: string | null): Promise<void> {
  await setUserSetting(userId, APP_SETTING_KEYS.myName, value);
}
