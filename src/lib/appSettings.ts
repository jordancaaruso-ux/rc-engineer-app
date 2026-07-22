import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const APP_SETTING_KEYS = {
  myName: "myName",
  liveRcDriverName: "liveRcDriverName",
  /** LiveRC `data-driver-id` for this account — used to disambiguate same-name drivers across mains. */
  liveRcDriverId: "liveRcDriverId",
  /** Display name on Speedhive results (optional; falls back to liveRcDriverName). */
  speedhiveDriverName: "speedhiveDriverName",
  /** Comma-separated or JSON array of MYLAPS transponder numbers for Speedhive discovery. */
  speedhiveTransponderNumbersJson: "speedhiveTransponderNumbersJson",
  /**
   * ISO timestamp the driver declared they race a club / loaner transponder, so
   * there is no number to give. Onboarding requires a transponder OR this — name
   * matching carries them instead. Cleared the moment a real number is saved.
   */
  speedhiveTransponderLoanerAt: "speedhiveTransponderLoanerAt",
  /** MYLAPS / Speedhive account id (from linked login). */
  mylapsAccountId: "mylapsAccountId",
  /** Bearer access token for usersandproducts-api (server only). */
  mylapsAccessToken: "mylapsAccessToken",
  mylapsRefreshToken: "mylapsRefreshToken",
  /** ISO expiry for access token when known. */
  mylapsTokenExpiresAt: "mylapsTokenExpiresAt",
  /** JSON array of chip numbers from linked account. */
  mylapsChipNumbersJson: "mylapsChipNumbersJson",
  /**
   * Current practice day timing-URL (e.g. LiveRC day results page) the driver
   * is working from. Persists across `New Run` forms so "copy last run" / fresh
   * Log Your Run sessions keep the same day URL pre-filled. Cleared manually
   * in the Settings tab when moving on to the next day.
   */
  currentPracticeDayUrl: "currentPracticeDayUrl",
  /**
   * Onboarding (docs/ONBOARDING_NORTH_STAR.md). Kept here rather than on `User`
   * so first-run state needs no migration.
   */
  /** ISO timestamp the guided intro was finished. Absent = not done. */
  onboardingCompletedAt: "onboardingCompletedAt",
  /**
   * ISO timestamp the dashboard intro card was answered (either button). It
   * shows ONCE — without this, "I'll look around first" writes nothing and the
   * card nags every load (the same trap the old `/welcome` takeover had,
   * caught in the browser 2026-07-22). Being "seen" is not progress; the
   * resume card still shows until the garage is actually ready.
   */
  onboardingSeenAt: "onboardingSeenAt",
  /** JSON array of step ids the driver skipped, e.g. `["sheet"]`, so we can re-offer them. */
  onboardingSkippedSteps: "onboardingSkippedSteps",
  /** ISO timestamp they tapped Ignore on the dashboard resume card — it never returns. */
  onboardingResumeDismissedAt: "onboardingResumeDismissedAt",
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

/**
 * Batch `myName` lookup for a set of users (e.g. team roster display names).
 * Returns a `userId → name` map with only the users who have a non-empty value.
 */
export async function getMyNameSettingsForUsers(
  userIds: string[]
): Promise<Record<string, string>> {
  if (userIds.length === 0) return {};
  try {
    const rows = await prisma.appSetting.findMany({
      where: { userId: { in: userIds }, key: APP_SETTING_KEYS.myName },
      select: { userId: true, value: true },
    });
    const out: Record<string, string> = {};
    for (const r of rows) {
      const v = r.value?.trim();
      if (v) out[r.userId] = v;
    }
    return out;
  } catch (err) {
    if (isMissingAppSettingTableError(err)) {
      console.warn("[appSettings] AppSetting table missing; returning empty name map");
      return {};
    }
    throw err;
  }
}

export async function setMyNameSetting(userId: string, value: string | null): Promise<void> {
  await setUserSetting(userId, APP_SETTING_KEYS.myName, value);
}

export async function getLiveRcDriverNameSetting(userId: string): Promise<string | null> {
  return getUserSetting(userId, APP_SETTING_KEYS.liveRcDriverName);
}

export async function setLiveRcDriverNameSetting(userId: string, value: string | null): Promise<void> {
  await setUserSetting(userId, APP_SETTING_KEYS.liveRcDriverName, value);
}

export async function getLiveRcDriverIdSetting(userId: string): Promise<string | null> {
  return getUserSetting(userId, APP_SETTING_KEYS.liveRcDriverId);
}

export async function setLiveRcDriverIdSetting(userId: string, value: string | null): Promise<void> {
  await setUserSetting(userId, APP_SETTING_KEYS.liveRcDriverId, value);
}

export async function getSpeedhiveDriverNameSetting(userId: string): Promise<string | null> {
  return getUserSetting(userId, APP_SETTING_KEYS.speedhiveDriverName);
}

export async function setSpeedhiveDriverNameSetting(userId: string, value: string | null): Promise<void> {
  await setUserSetting(userId, APP_SETTING_KEYS.speedhiveDriverName, value);
}

export async function getSpeedhiveTransponderNumbersSetting(userId: string): Promise<string | null> {
  return getUserSetting(userId, APP_SETTING_KEYS.speedhiveTransponderNumbersJson);
}

export async function setSpeedhiveTransponderNumbersSetting(
  userId: string,
  value: string | null
): Promise<void> {
  await setUserSetting(userId, APP_SETTING_KEYS.speedhiveTransponderNumbersJson, value);
}

export async function getSpeedhiveTransponderLoanerSetting(userId: string): Promise<boolean> {
  return Boolean(await getUserSetting(userId, APP_SETTING_KEYS.speedhiveTransponderLoanerAt));
}

export async function setSpeedhiveTransponderLoanerSetting(
  userId: string,
  value: boolean,
  when: Date = new Date()
): Promise<void> {
  await setUserSetting(
    userId,
    APP_SETTING_KEYS.speedhiveTransponderLoanerAt,
    value ? when.toISOString() : null
  );
}

export async function getSpeedhiveDriverNameForUser(userId: string): Promise<string | null> {
  const sh = (await getSpeedhiveDriverNameSetting(userId))?.trim();
  if (sh) return sh;
  return (await getLiveRcDriverNameSetting(userId))?.trim() || null;
}

export async function getCurrentPracticeDayUrlSetting(userId: string): Promise<string | null> {
  return getUserSetting(userId, APP_SETTING_KEYS.currentPracticeDayUrl);
}

export async function setCurrentPracticeDayUrlSetting(userId: string, value: string | null): Promise<void> {
  await setUserSetting(userId, APP_SETTING_KEYS.currentPracticeDayUrl, value);
}

/* ── Onboarding (docs/ONBOARDING_NORTH_STAR.md) ────────────────────────────── */

/** Steps of the set-up wizard a driver is allowed to skip and be re-offered. */
export const ONBOARDING_SKIPPABLE_STEPS = ["sheet", "track"] as const;
export type OnboardingSkippableStep = (typeof ONBOARDING_SKIPPABLE_STEPS)[number];

export type OnboardingState = {
  /** True once the guided intro has been finished (or explicitly completed later). */
  completed: boolean;
  completedAt: string | null;
  /** Steps they chose to skip — drives the "add it later" re-offers. */
  skippedSteps: OnboardingSkippableStep[];
  /** True once they tapped Ignore on the dashboard resume card. */
  resumeDismissed: boolean;
  /** True once the dashboard intro card was answered — it never shows twice. */
  seen: boolean;
};

/** Tolerant parse — a hand-edited or legacy value must never break the dashboard. */
export function parseOnboardingSkippedSteps(raw: string | null): OnboardingSkippableStep[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const allowed = new Set<string>(ONBOARDING_SKIPPABLE_STEPS);
  const out: OnboardingSkippableStep[] = [];
  for (const v of parsed) {
    if (typeof v === "string" && allowed.has(v) && !out.includes(v as OnboardingSkippableStep)) {
      out.push(v as OnboardingSkippableStep);
    }
  }
  return out;
}

export async function getOnboardingState(userId: string): Promise<OnboardingState> {
  const [completedAt, skippedRaw, dismissedAt, seenAt] = await Promise.all([
    getUserSetting(userId, APP_SETTING_KEYS.onboardingCompletedAt),
    getUserSetting(userId, APP_SETTING_KEYS.onboardingSkippedSteps),
    getUserSetting(userId, APP_SETTING_KEYS.onboardingResumeDismissedAt),
    getUserSetting(userId, APP_SETTING_KEYS.onboardingSeenAt),
  ]);
  return {
    completed: Boolean(completedAt),
    completedAt: completedAt ?? null,
    skippedSteps: parseOnboardingSkippedSteps(skippedRaw),
    resumeDismissed: Boolean(dismissedAt),
    seen: Boolean(seenAt),
  };
}

/** Records that the takeover has fired, so it never fires again. Idempotent. */
export async function markOnboardingSeen(userId: string, when: Date = new Date()): Promise<void> {
  const existing = await getUserSetting(userId, APP_SETTING_KEYS.onboardingSeenAt);
  if (existing) return;
  await setUserSetting(userId, APP_SETTING_KEYS.onboardingSeenAt, when.toISOString());
}

export async function markOnboardingCompleted(userId: string, when: Date = new Date()): Promise<void> {
  await setUserSetting(userId, APP_SETTING_KEYS.onboardingCompletedAt, when.toISOString());
}

export async function setOnboardingSkippedSteps(
  userId: string,
  steps: OnboardingSkippableStep[]
): Promise<void> {
  const unique = Array.from(new Set(steps));
  await setUserSetting(
    userId,
    APP_SETTING_KEYS.onboardingSkippedSteps,
    unique.length ? JSON.stringify(unique) : null
  );
}

export async function dismissOnboardingResume(userId: string, when: Date = new Date()): Promise<void> {
  await setUserSetting(userId, APP_SETTING_KEYS.onboardingResumeDismissedAt, when.toISOString());
}
