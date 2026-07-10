/**
 * One honest haptic entry point for the whole app.
 *
 * Layered by capability, best → nothing, and never throws into a click handler:
 *   1. **Native shell** (Capacitor iOS/Android) → the real Taptic Engine via
 *      `@capacitor/haptics` — proper impact / notification styles.
 *   2. **Web** (Android Chrome, Edge, Samsung Internet, …) → `navigator.vibrate`.
 *   3. **iOS Safari on the web** → silently ignored (no `navigator.vibrate`,
 *      and installing to the home screen doesn't change that). We do NOT ship the
 *      hidden-`<input switch>` polyfill: Apple gates it to a 1s user-gesture
 *      window and can close it in a point release — not worth the fragility for
 *      a nice-to-have. If we want honest iOS haptics on the web, that's the cue
 *      to wrap the PWA in the Capacitor shell, where path (1) already covers it.
 *
 * Fire ONLY on discrete, user-initiated actions (tab change, Log run, a PB
 * landing). Never for ambient/looping feedback — the web path can't do it and
 * the native path would feel cheap.
 */
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

export type HapticKind = "light" | "medium" | "success";

/** Web vibration fallback durations (ms); success is a short double-tick. */
const WEB_PATTERN: Record<HapticKind, number | number[]> = {
  light: 8,
  medium: 12,
  success: [10, 40, 12],
};

export function haptic(kind: HapticKind = "light"): void {
  if (typeof window === "undefined") return;
  try {
    if (Capacitor.isNativePlatform()) {
      if (kind === "success") {
        void Haptics.notification({ type: NotificationType.Success });
      } else {
        void Haptics.impact({
          style: kind === "medium" ? ImpactStyle.Medium : ImpactStyle.Light,
        });
      }
      return;
    }
    navigator.vibrate?.(WEB_PATTERN[kind]);
  } catch {
    // Haptics are enhancement-only — a failure here must never break the tap.
  }
}
