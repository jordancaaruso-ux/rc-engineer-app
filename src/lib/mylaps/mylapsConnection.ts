import "server-only";

import {
  APP_SETTING_KEYS,
  getUserSetting,
  setUserSetting,
} from "@/lib/appSettings";

export type MylapsConnection = {
  accountId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  chipNumbers: number[];
};

export async function getMylapsConnection(userId: string): Promise<MylapsConnection | null> {
  const [accountId, accessToken, refreshToken, expiresAt, chipsJson] = await Promise.all([
    getUserSetting(userId, APP_SETTING_KEYS.mylapsAccountId),
    getUserSetting(userId, APP_SETTING_KEYS.mylapsAccessToken),
    getUserSetting(userId, APP_SETTING_KEYS.mylapsRefreshToken),
    getUserSetting(userId, APP_SETTING_KEYS.mylapsTokenExpiresAt),
    getUserSetting(userId, APP_SETTING_KEYS.mylapsChipNumbersJson),
  ]);
  if (!accountId?.trim() || !accessToken?.trim()) return null;

  let chipNumbers: number[] = [];
  if (chipsJson?.trim()) {
    try {
      const parsed = JSON.parse(chipsJson) as unknown;
      if (Array.isArray(parsed)) {
        chipNumbers = parsed
          .map((n) => (typeof n === "number" ? n : Number(n)))
          .filter((n) => Number.isFinite(n) && n > 0);
      }
    } catch {
      chipNumbers = [];
    }
  }

  return {
    accountId: accountId.trim(),
    accessToken: accessToken.trim(),
    refreshToken: refreshToken?.trim() || null,
    expiresAt: expiresAt?.trim() || null,
    chipNumbers,
  };
}

export async function hasMylapsConnection(userId: string): Promise<boolean> {
  return (await getMylapsConnection(userId)) != null;
}

export async function saveMylapsConnection(
  userId: string,
  data: {
    accountId: string;
    accessToken: string;
    refreshToken?: string | null;
    expiresAt?: string | null;
    chipNumbers?: number[];
  }
): Promise<void> {
  await Promise.all([
    setUserSetting(userId, APP_SETTING_KEYS.mylapsAccountId, data.accountId),
    setUserSetting(userId, APP_SETTING_KEYS.mylapsAccessToken, data.accessToken),
    setUserSetting(userId, APP_SETTING_KEYS.mylapsRefreshToken, data.refreshToken ?? null),
    setUserSetting(userId, APP_SETTING_KEYS.mylapsTokenExpiresAt, data.expiresAt ?? null),
    setUserSetting(
      userId,
      APP_SETTING_KEYS.mylapsChipNumbersJson,
      data.chipNumbers?.length ? JSON.stringify(data.chipNumbers) : null
    ),
  ]);
}

export async function clearMylapsConnection(userId: string): Promise<void> {
  await Promise.all([
    setUserSetting(userId, APP_SETTING_KEYS.mylapsAccountId, null),
    setUserSetting(userId, APP_SETTING_KEYS.mylapsAccessToken, null),
    setUserSetting(userId, APP_SETTING_KEYS.mylapsRefreshToken, null),
    setUserSetting(userId, APP_SETTING_KEYS.mylapsTokenExpiresAt, null),
    setUserSetting(userId, APP_SETTING_KEYS.mylapsChipNumbersJson, null),
  ]);
}
