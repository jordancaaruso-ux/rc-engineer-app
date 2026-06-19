import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function HeroPanel({
  children,
  className,
  variant = "emerald",
}: {
  children: ReactNode;
  className?: string;
  /** `muted` = loading / idle strip without emerald accent */
  variant?: "emerald" | "muted";
}) {
  return (
    <div
      className={cn(
        "relative rounded-xl px-3 py-2.5 shadow-[0_16px_34px_-24px_rgba(0,0,0,0.72)]",
        variant === "emerald"
          ? "border border-emerald-400/25 bg-emerald-500/[0.06]"
          : "border border-border bg-muted/20",
        className
      )}
    >
      {children}
    </div>
  );
}
