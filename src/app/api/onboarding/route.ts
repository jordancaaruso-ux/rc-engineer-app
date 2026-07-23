import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import {
  APP_SETTING_KEYS,
  dismissOnboardingResume,
  getOnboardingState,
  markOnboardingSeen,
  setUserSetting,
} from "@/lib/appSettings";
import { isAuthAdminEmail } from "@/lib/authAdmin";

/**
 * First-run side effects — docs/ONBOARDING_NORTH_STAR.md (reversal 2026-07-23).
 *
 * Car, timing and setup all go through their own real endpoints, and readiness is
 * DERIVED (never written here). This route only covers what has nowhere else to
 * live: marking the welcome overlay seen, dismissing the "Get set up" card, and
 * the admin reset that lets onboarding be re-run. The old GET (the guide chip's
 * progress read) and the `home-track` / `complete` actions are gone with the chip.
 */
type Body =
  | { action: "seen" }
  | { action: "dismiss-resume" }
  | { action: "reset" };

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
    if (body.action === "seen") {
      // The welcome overlay was answered (either button) — it never shows again.
      await markOnboardingSeen(user.id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "dismiss-resume") {
      await dismissOnboardingResume(user.id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "reset") {
      // Testing affordance only — onboarding is the one flow you can't re-experience,
      // so admins get to re-run it. Never opened to users.
      if (!isAuthAdminEmail(user.email)) {
        return NextResponse.json({ error: "Admins only" }, { status: 403 });
      }
      await Promise.all([
        setUserSetting(user.id, APP_SETTING_KEYS.onboardingSeenAt, null),
        setUserSetting(user.id, APP_SETTING_KEYS.onboardingResumeDismissedAt, null),
        // Legacy keys from the retired guide — cleared too so a reset is a clean slate.
        setUserSetting(user.id, APP_SETTING_KEYS.onboardingCompletedAt, null),
        setUserSetting(user.id, APP_SETTING_KEYS.onboardingSkippedSteps, null),
      ]);
      return NextResponse.json(await getOnboardingState(user.id));
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Onboarding update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
