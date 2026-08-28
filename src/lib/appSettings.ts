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
  /**
   * Other people's transponders you know — teammates, rivals. JSON array of
   * `{ name, transponder }`; see `lib/speedhive/knownCompetitors.ts`. Pulled only when
   * asked, never on a schedule.
   */
  knownCompetitorsJson: "knownCompetitorsJson",
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
  /**
   * Engineer lab rungs (see `lib/engineerChat/lab/`). "1" = on. Admin-only, default off, and
   * off means the account gets exactly the shipped Engineer — these keys are the only way any
   * extra context reaches the model.
   *
   * Per-user on purpose: adding a second admin gives them the toggles, not the behaviour.
   */
  engineerLabSetupSheet: "engineerLabSetupSheet",
  engineerLabSessionFacts: "engineerLabSessionFacts",
  engineerLabComparableRuns: "engineerLabComparableRuns",
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
  return getSettingForUsers(userIds, APP_SETTING_KEYS.myName);
}

/**
 * One setting for a set of users, as a `userId → value` map holding only the users who have a
 * non-empty value.
 *
 * Generalised out of `getMyNameSettingsForUsers` when the Analysis "Out with you" card needed the
 * same batch shape for `liveRcDriverName` — it resolves a driver's display name through both keys
 * in turn, and two near-identical readers is how the two fall out of step.
 */
export async function getSettingForUsers(
  userIds: string[],
  key: string
): Promise<Record<string, string>> {
  if (userIds.length === 0) return {};
  try {
    const rows = await prisma.appSetting.findMany({
      where: { userId: { in: userIds }, key },
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
      console.warn(`[appSettings] AppSetting table missing; returning empty map for ${key}`);
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

export async function getKnownCompetitorsSetting(userId: string): Promise<string | null> {
  return getUserSetting(userId, APP_SETTING_KEYS.knownCompetitorsJson);
}

export async function setKnownCompetitorsSetting(
  userId: string,
  value: string | null
): Promise<void> {
  await setUserSetting(userId, APP_SETTING_KEYS.knownCompetitorsJson, value);
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

/*
 * The MyRCM identity *setters* were removed on 2026-08-26 along with MyRCM page scraping (see
 * `timingUrlSafetySync.ts`). MyRCM import came back on 2026-08-27 as a PDF the driver uploads, and
 * matching them to a row in it still needs a name — MyRCM publishes no driver id and no transponder
 * in its results, so the name is the only handle it has ever had.
 *
 * Read-only, and deliberately by literal key: the row is legacy, `APP_SETTING_KEYS` no longer
 * carries it, and nothing writes one any more. Drivers who saved a name before get their row
 * pre-selected; everyone else picks from the field, which the upload flow shows either way.
 */
export async function getMyRcmDriverNamesForUser(userId: string): Promise<string[]> {
  const [legacyRow, speedhive, liveRc] = await Promise.all([
    // Not via `getUserSetting`: `AppSettingKey` no longer lists this key, by design.
    prisma.appSetting
      .findUnique({ where: { userId_key: { userId, key: "myRcmDriverName" } }, select: { value: true } })
      .catch(() => null),
    getSpeedhiveDriverNameSetting(userId),
    getLiveRcDriverNameSetting(userId),
  ]);
  const legacyMyRcm = legacyRow?.value ?? null;

  const names: string[] = [];
  for (const name of [legacyMyRcm, speedhive, liveRc]) {
    const trimmed = name?.trim();
    if (trimmed && !names.includes(trimmed)) names.push(trimmed);
  }
  return names;
}

export async function getCurrentPracticeDayUrlSetting(userId: string): Promise<string | null> {
  return getUserSetting(userId, APP_SETTING_KEYS.currentPracticeDayUrl);
}

export async function setCurrentPracticeDayUrlSetting(userId: string, value: string | null): Promise<void> {
  await setUserSetting(userId, APP_SETTING_KEYS.currentPracticeDayUrl, value);
}

/* ── Onboarding (docs/ONBOARDING_NORTH_STAR.md, reversal 2026-07-23) ─────────── */

/**
 * First-run state. The old guide chip + 4-step progress + "completed"/"skipped"
 * concepts are gone (2026-07-23): readiness is now DERIVED (a car, a timing
 * identity, a setup) in `lib/onboarding/server.ts`. Only two flags remain — the
 * welcome overlay was answered, and the "Get set up" card was dismissed. The old
 * `onboardingCompletedAt` / `onboardingSkippedSteps` keys are kept (legacy rows,
 * and the admin reset still clears them) but nothing writes them any more.
 */
export type OnboardingState = {
  /** True once the welcome overlay was answered — it never shows twice. */
  seen: boolean;
  /** True once they tapped Ignore on the dashboard "Get set up" card. */
  resumeDismissed: boolean;
};

export async function getOnboardingState(userId: string): Promise<OnboardingState> {
  const [dismissedAt, seenAt] = await Promise.all([
    getUserSetting(userId, APP_SETTING_KEYS.onboardingResumeDismissedAt),
    getUserSetting(userId, APP_SETTING_KEYS.onboardingSeenAt),
  ]);
  return {
    seen: Boolean(seenAt),
    resumeDismissed: Boolean(dismissedAt),
  };
}

/** Records that the welcome overlay was answered, so it never shows again. Idempotent. */
export async function markOnboardingSeen(userId: string, when: Date = new Date()): Promise<void> {
  const existing = await getUserSetting(userId, APP_SETTING_KEYS.onboardingSeenAt);
  if (existing) return;
  await setUserSetting(userId, APP_SETTING_KEYS.onboardingSeenAt, when.toISOString());
}

export async function dismissOnboardingResume(userId: string, when: Date = new Date()): Promise<void> {
  await setUserSetting(userId, APP_SETTING_KEYS.onboardingResumeDismissedAt, when.toISOString());
}
