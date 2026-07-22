import { prisma } from "@/lib/prisma";
import {
  getLiveRcDriverNameSetting,
  getMyNameSetting,
  getOnboardingState,
  getSpeedhiveTransponderLoanerSetting,
  type OnboardingState,
} from "@/lib/appSettings";
import { getSpeedhiveTransponderNumbersForUser } from "@/lib/speedhive/speedhiveDriverSettings";
import { getFavouriteTrackIdsForUser } from "@/lib/track-favourites";
import { computeOnboardingProgress, type OnboardingProgress } from "@/lib/onboarding/progress";

/**
 * Dashboard + guide-chip view of first-run progress — docs/ONBOARDING_NORTH_STAR.md.
 *
 * Home track = a favourited track, falling back to the track on their most
 * recent run, so someone who logged a run without ever favouriting anything
 * still reads as set up.
 */
export type OnboardingView = {
  progress: OnboardingProgress;
  state: OnboardingState;
  /** They have logged at least one run — the guided intro's natural end. */
  hasAnyRun: boolean;
  /**
   * Truly untouched account that hasn't met the guide yet: show the dashboard
   * intro card ("Let's get your garage ready"). `state.seen` terminates it —
   * without that, "I'll look around first" was a trap (caught 2026-07-22).
   */
  showIntro: boolean;
  /** Garage just became ready and no run exists yet: the quiet payoff moment. */
  showPayoff: boolean;
};

export async function loadOnboardingView(userId: string): Promise<OnboardingView> {
  const [
    state,
    name,
    timingName,
    transponders,
    transponderLoaner,
    car,
    favouriteTrackIds,
    lastTrackRun,
    anyRun,
    tireSet,
  ] = await Promise.all([
    getOnboardingState(userId),
    getMyNameSetting(userId),
    getLiveRcDriverNameSetting(userId),
    getSpeedhiveTransponderNumbersForUser(userId),
    getSpeedhiveTransponderLoanerSetting(userId),
    prisma.car.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { name: true },
    }),
    getFavouriteTrackIdsForUser(userId),
    prisma.run.findFirst({
      where: { userId, trackId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { track: { select: { name: true } } },
    }),
    prisma.run.findFirst({ where: { userId }, select: { id: true } }),
    prisma.tireSet.findFirst({
      where: { userId, archivedAt: null },
      orderBy: { createdAt: "asc" },
      select: { label: true },
    }),
  ]);

  let trackName = lastTrackRun?.track?.name ?? null;
  if (!trackName && favouriteTrackIds.length > 0) {
    const fav = await prisma.track.findUnique({
      where: { id: favouriteTrackIds[0]! },
      select: { name: true },
    });
    trackName = fav?.name ?? null;
  }

  const progress = computeOnboardingProgress({
    name,
    timingName,
    transponderCount: transponders.length,
    transponderLoaner,
    carName: car?.name ?? null,
    trackName,
    tireSetName: tireSet?.label ?? null,
    state,
  });

  const hasAnyRun = anyRun != null;
  return {
    progress,
    state,
    hasAnyRun,
    showIntro:
      !state.seen && !state.completed && !state.resumeDismissed && car == null && !hasAnyRun,
    showPayoff: progress.complete && !state.completed && !hasAnyRun,
  };
}

/** Back-compat name used by the dashboard before the guided-intro rework. */
export async function loadOnboardingProgress(userId: string): Promise<OnboardingProgress> {
  return (await loadOnboardingView(userId)).progress;
}
