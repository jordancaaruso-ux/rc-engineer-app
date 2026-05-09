import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SectionTitle({
  as: Tag = "h2",
  className,
  children,
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  return <Tag className={cn("text-sm font-semibold text-foreground", className)}>{children}</Tag>;
}

export function SectionMeta({
  as: Tag = "p",
  className,
  children,
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  return <Tag className={cn("text-[11px] text-muted-foreground leading-snug", className)}>{children}</Tag>;
}

/** Same typography as SectionMeta for inline / baseline-aligned scope lines. */
export function SectionMetaInline({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn("text-[11px] text-muted-foreground leading-snug", className)}>{children}</span>;
}
