import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import {
  APP_SETTING_KEYS,
  ONBOARDING_SKIPPABLE_STEPS,
  dismissOnboardingResume,
  getOnboardingState,
  markOnboardingCompleted,
  markOnboardingSeen,
  setOnboardingSkippedSteps,
  setUserSetting,
  type OnboardingSkippableStep,
} from "@/lib/appSettings";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { addTrackToFavourites } from "@/lib/track-favourites";
import { revalidateAfterTrackMutation } from "@/lib/revalidateUser";
import { loadOnboardingView } from "@/lib/onboarding/server";

/**
 * Guided-intro side effects — docs/ONBOARDING_NORTH_STAR.md.
 *
 * Name, car, track and tires all go through their own real endpoints — the
 * guide watches derived progress, it never writes it. This route only covers
 * what has nowhere else to live: marking the intro seen, finishing early,
 * dismissing the resume card, and the guide chip's progress read.
 */

type Body =
  | { action: "home-track"; trackId?: string }
  | { action: "seen" }
  | { action: "complete"; skippedSteps?: string[] }
  | { action: "dismiss-resume" }
  | { action: "reset" };

function isSkippable(v: string): v is OnboardingSkippableStep {
  return (ONBOARDING_SKIPPABLE_STEPS as readonly string[]).includes(v);
}

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // The guide chip's read: derived progress + the flags that decide chip state.
  const view = await loadOnboardingView(user.id);
  return NextResponse.json({
    state: view.state,
    progress: view.progress,
    hasAnyRun: view.hasAnyRun,
    showPayoff: view.showPayoff,
  });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }

  try {
    if (body.action === "home-track") {
      const trackId = body.trackId?.trim();
      if (!trackId) {
        return NextResponse.json({ error: "trackId is required" }, { status: 400 });
      }
      // Tracks are a global catalog, so this only needs to exist — not be owned.
      const track = await prisma.track.findUnique({ where: { id: trackId }, select: { id: true } });
      if (!track) {
        return NextResponse.json({ error: "Unknown track" }, { status: 404 });
      }
      await addTrackToFavourites(user.id, track.id);
      revalidateAfterTrackMutation(user.id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "seen") {
      // The intro card was answered (either button) — `/` stops showing it.
      await markOnboardingSeen(user.id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "complete") {
      const skipped = Array.isArray(body.skippedSteps)
        ? body.skippedSteps.filter((s): s is string => typeof s === "string").filter(isSkippable)
        : [];
      await setOnboardingSkippedSteps(user.id, skipped);
      await markOnboardingCompleted(user.id);
      return NextResponse.json(await getOnboardingState(user.id));
    }

    if (body.action === "dismiss-resume") {
      await dismissOnboardingResume(user.id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "reset") {
      // Testing affordance only — onboarding is the one flow you can't
      // re-experience, so admins get to re-run it. Never opened to users.
      if (!isAuthAdminEmail(user.email)) {
        return NextResponse.json({ error: "Admins only" }, { status: 403 });
      }
      await Promise.all([
        setUserSetting(user.id, APP_SETTING_KEYS.onboardingCompletedAt, null),
        setUserSetting(user.id, APP_SETTING_KEYS.onboardingSkippedSteps, null),
        setUserSetting(user.id, APP_SETTING_KEYS.onboardingResumeDismissedAt, null),
        setUserSetting(user.id, APP_SETTING_KEYS.onboardingSeenAt, null),
      ]);
      return NextResponse.json(await getOnboardingState(user.id));
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Onboarding update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
