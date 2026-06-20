import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SurfaceCard } from "@/components/ui/SurfaceCard";

/**
 * Dashboard panel surface — flat charcoal card; glow on hover (via SurfaceCard).
 * Use SurfaceCard directly when you need `hero` variant or custom padding.
 */
export function CardPanel({
  children,
  className,
  contentClassName,
  overflowHidden,
}: {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  overflowHidden?: boolean;
}) {
  return (
    <SurfaceCard
      variant="panel"
      className={className}
      contentClassName={contentClassName}
      overflowHidden={overflowHidden}
    >
      {children}
    </SurfaceCard>
  );
}
