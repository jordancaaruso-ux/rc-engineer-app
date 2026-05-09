import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Neutral elevated surface (radius + padding aligned with dashboard cards). */
export function CardPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card/80 p-4 shadow-sm", className)}>{children}</div>
  );
}
