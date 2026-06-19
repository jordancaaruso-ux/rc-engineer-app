import type { ReactNode } from "react";

import { cn } from "@/lib/utils";



/** Espresso base shared by dashboard hero + panel cards. */

const SURFACE_BASE = "#1b1712";



export type SurfaceCardGlowMode = "hover" | "idle-drift" | "none";



/**

 * Warm espresso surface. Flat by default; yellow/brown radial glow fades in on hover.

 * `hero` keeps slightly stronger shadow and rounded-2xl.

 * `idle-drift` keeps a slow always-on glow for tappable affordance cards.

 */

export function SurfaceCard({

  children,

  variant = "panel",

  className,

  contentClassName,

  overflowHidden = true,

  glowMode = "hover",

  muted = false,

}: {

  children: ReactNode;

  variant?: "hero" | "panel";

  className?: string;

  /** Applied to the inner content wrapper. Pass `p-0` for custom/flush layouts. */

  contentClassName?: string;

  overflowHidden?: boolean;

  /** `hover` = glow on hover (default). `idle-drift` = slow always-on drift. `none` = off. */

  glowMode?: SurfaceCardGlowMode;

  /** Subtle grey-out after an action (e.g. copy last run applied). */

  muted?: boolean;

}) {

  const isHero = variant === "hero";

  const radiusClass = isHero ? "rounded-2xl" : "rounded-xl";

  const showHoverGlow = glowMode === "hover";

  const showIdleGlow = glowMode === "idle-drift" && !muted;



  return (

    <div

      className={cn(

        "group relative border border-border transition-[opacity,filter] duration-500",

        radiusClass,

        isHero

          ? "shadow-[0_24px_70px_-30px_rgba(0,0,0,0.8)]"

          : "shadow-[0_18px_50px_-28px_rgba(0,0,0,0.75)]",

        muted && "opacity-[0.72] saturate-[0.85]",

        className

      )}

      style={{ backgroundColor: SURFACE_BASE }}

    >

      {showHoverGlow ? (

        <div

          aria-hidden

          className={cn(

            "pointer-events-none absolute inset-0 overflow-hidden opacity-0 transition-opacity duration-500 group-hover:opacity-100",

            radiusClass

          )}

        >

          <div className="surface-card-glow absolute -inset-[20px]" />

        </div>

      ) : null}

      {showIdleGlow ? (

        <div

          aria-hidden

          className={cn("pointer-events-none absolute inset-0 overflow-hidden opacity-[0.65]", radiusClass)}

        >

          <div className="surface-card-glow-idle absolute -inset-[20px]" />

        </div>

      ) : null}

      {showHoverGlow ? (

        <div

          aria-hidden

          className="surface-card-hairline pointer-events-none absolute inset-x-0 top-0 h-px opacity-0 transition-opacity duration-500 group-hover:opacity-100"

        />

      ) : null}

      <div

        className={cn(

          "relative",

          radiusClass,

          overflowHidden && "overflow-hidden",

          isHero ? "p-4 sm:p-5" : "p-3",

          contentClassName

        )}

      >

        {children}

      </div>

    </div>

  );

}

