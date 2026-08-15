import type { ReactNode } from "react";
import { TelemetryBackground } from "@/components/brand/TelemetryBackground";

/**
 * DoorScene — the one backdrop behind every signed-out page (2026-08-15 redesign).
 *
 * Three layers, bottom to top:
 *   1. The baked photo — `public/brand/door-scene-baked.jpg`, the drivers-meeting shot with
 *      blur and grade baked at build time (regenerate with sharp: resize 1600, blur 14,
 *      brightness .94, saturation 1.06). Baked because a runtime `filter: blur(13px)` over a
 *      full-viewport layer is the most expensive paint on the page; the same reasoning as
 *      track-hero-baked.jpg on the landing.
 *   2. The login telemetry canvas, transparent, at reduced intensity — the same component
 *      /login has always run, now compositing over the photo instead of flat charcoal.
 *   3. A scrim, in CSS because it is viewport-relative where the photo's grade is not.
 *
 * Two scrims, not a knob:
 *   - `join`  — the plan-picker hero: lighter through the middle so the photo reads,
 *     darkening to near-opaque at the foot so the fine print never fights the crowd.
 *   - `focus` — login / code / success: one small card in the middle of the room, so the
 *     scrim is flatter and heavier, plus the login page's yellow whisper overhead.
 *
 * Sits inside a `position: relative` page wrapper and fills it (absolute, not fixed —
 * fixed children escape on iOS when an ancestor gains a backdrop-filter). The wrapper
 * must also carry `.door-dark`: these pages are charcoal in both themes by decision,
 * and the photo is graded once for charcoal.
 */
export function DoorScene({ variant }: { variant: "join" | "focus" }): ReactNode {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute -inset-5 bg-cover"
        style={{
          backgroundImage: "url(/brand/door-scene-baked.jpg)",
          backgroundPosition: "center 38%",
        }}
      />
      <TelemetryBackground transparent intensity={0.8} />
      {variant === "join" ? (
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgb(12 12 11 / 0.78) 0%, rgb(12 12 11 / 0.5) 26%, rgb(12 12 11 / 0.72) 62%, rgb(18 17 16 / 0.97) 100%)",
          }}
        />
      ) : (
        <>
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, rgb(12 12 11 / 0.72) 0%, rgb(12 12 11 / 0.78) 55%, rgb(18 17 16 / 0.9) 100%)",
            }}
          />
          {/* Yellow hero whisper — carried over from the shipped login page. */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(115% 75% at 50% -8%, rgba(255,214,10,0.12), rgba(255,214,10,0) 55%)",
            }}
          />
        </>
      )}
      {/* Top hairline accent — the family's shared jewellery. */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
    </div>
  );
}
