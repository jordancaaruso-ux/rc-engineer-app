import type { CSSProperties, ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SectionTitle({
  as: Tag = "h2",
  className,
  style,
  children,
}: {
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return <Tag className={cn("section-title", className)} style={style}>{children}</Tag>;
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
