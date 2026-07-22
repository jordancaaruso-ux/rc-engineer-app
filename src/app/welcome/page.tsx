import { redirect } from "next/navigation";

/**
 * The full-screen set-up wizard died 2026-07-22 (round 3): onboarding is now a
 * guided intro layered over the real app — dashboard intro card + guide chip +
 * highlighted taps (docs/ONBOARDING_NORTH_STAR.md). This stub only catches
 * stale links and PWA-cached entries.
 */
export default function WelcomePage(): never {
  redirect("/");
}
