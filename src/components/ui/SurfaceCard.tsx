import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Charcoal glass panel surface — the shared card "lift".
 *
 * `.glass-card` (globals.css) owns the frosted look: translucent fill +
 * `backdrop-filter` blur over the page wash, a light border, and a specular
 * shadow stack. This replaced the old scroll-focus / hover / idle yellow glow
 * (June 2026) — cards read as frosted glass at rest, no JS, no `--focus` var.
 * `hero` just keeps `rounded-2xl`.
 */
export function SurfaceCard({
  children,
  variant = "panel",
  className,
  contentClassName,
  overflowHidden = true,
  muted = false,
  bare = false,
  dataTour,
}: {
  children: ReactNode;
  variant?: "hero" | "panel";
  className?: string;
  /**
   * `data-tour` anchor id for the demo walkthrough (`src/lib/demo/tourSteps.ts`). Inert
   * markup — it changes nothing about how the card renders, and only the tour ever reads it.
   * An explicit prop rather than a `...rest` spread because this component enumerates its
   * props on purpose.
   */
  dataTour?: string;
  /** Applied to the inner content wrapper. Pass `p-0` for custom/flush layouts. */
  contentClassName?: string;
  overflowHidden?: boolean;
  /** Subtle grey-out after an action (e.g. copy last run applied). */
  muted?: boolean;
  /**
   * Drop the glass chrome entirely (no border, fill, radius, or padding) and
   * render the content as a plain section — for surfaces that live INSIDE
   * another card (e.g. the log-run wizard's unified Session card) without
   * changing the children's structure between modes.
   */
  bare?: boolean;
}) {
  const isHero = variant === "hero";
  const radiusClass = isHero ? "rounded-2xl" : "rounded-xl";

  if (bare) {
    return (
      <div className={className} data-tour={dataTour}>
        <div className={cn("relative", contentClassName)}>{children}</div>
      </div>
    );
  }

  return (
    <div
      data-tour={dataTour}
      className={cn(
        // `.glass-card` owns background alpha, backdrop blur, border color, and shadows.
        "glass-card group relative border transition-[opacity,filter] duration-500",
        radiusClass,
        muted && "opacity-[0.72] saturate-[0.85]",
        className
      )}
    >
      <div
        className={cn(
          "relative",
          radiusClass,
          overflowHidden && "overflow-hidden",
          "p-3",
          contentClassName
        )}
      >
        {children}
      </div>
    </div>
  );
}
