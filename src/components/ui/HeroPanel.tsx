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
        "rounded-xl px-4 py-3 shadow-sm",
        variant === "emerald"
          ? "border border-emerald-500/30 bg-emerald-500/5 shadow-black/20"
          : "border border-border bg-muted/20",
        className
      )}
    >
      {children}
    </div>
  );
}
