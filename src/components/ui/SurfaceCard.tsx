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
}: {
  children: ReactNode;
  variant?: "hero" | "panel";
  className?: string;
  /** Applied to the inner content wrapper. Pass `p-0` for custom/flush layouts. */
  contentClassName?: string;
  overflowHidden?: boolean;
  /** Subtle grey-out after an action (e.g. copy last run applied). */
  muted?: boolean;
}) {
  const isHero = variant === "hero";
  const radiusClass = isHero ? "rounded-2xl" : "rounded-xl";

  return (
    <div
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
