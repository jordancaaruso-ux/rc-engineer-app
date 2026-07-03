import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Technical v2 shared panel vocabulary — the visual DNA that started on the
 * dashboard hero. Use these so every card/section reads as one designed system:
 * a mono uppercase eyebrow for section labels, and hairline-separated stat tiles
 * (JetBrains Mono, tabular) for numbers — the "instrument panel" feel.
 */

/** Card headline — Sora bold (hero voice; 700, sentence case). */
export function PanelTitle({
  children,
  className,
  as: Tag = "h2",
}: {
  children: ReactNode;
  className?: string;
  as?: "h1" | "h2" | "h3" | "span";
}) {
  return (
    <Tag
      className={cn(
        "text-[20px] font-bold leading-tight tracking-tight text-foreground sm:text-[22px]",
        className
      )}
    >
      {children}
    </Tag>
  );
}

/** Nav hub row label — Inter semibold (`.hub-row-title` in globals.css). */
export function HubRowTitle({
  children,
  className,
  as: Tag = "span",
}: {
  children: ReactNode;
  className?: string;
  as?: "h2" | "h3" | "span";
}) {
  return (
    <Tag
      className={cn(
        "hub-row-title text-[17px] text-foreground sm:text-[18px]",
        className
      )}
    >
      {children}
    </Tag>
  );
}

/** Muted supporting line under a panel title (matches hero subtitle). */
export function PanelSubtitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-[13px] leading-relaxed text-muted-foreground", className)}>{children}</p>
  );
}

/** Mono uppercase tracked section label with an optional accent tick. */
export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  /** Retained for call-site compatibility; leading dots were removed from the label system. */
  dot?: "accent" | "gain" | "loss" | "muted";
  className?: string;
}) {
  return (
    <div className={cn("flex items-center", className)}>
      <span className="eyebrow-label">{children}</span>
    </div>
  );
}

/** Hairline-separated container for StatTile cells (instrument-panel strip). */
export function StatStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "grid gap-px overflow-hidden rounded-xl border border-border bg-border",
        className
      )}
    >
      {children}
    </div>
  );
}

/** A single metric cell — mono label + tabular mono value. */
export function StatTile({
  label,
  value,
  accent = false,
  className,
}: {
  label: string;
  value: ReactNode;
  /** Render the value in the yellow accent (use for the headline number). */
  accent?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("bg-background/55 px-3 py-2.5", className)}>
      <div className="type-data-label">{label}</div>
      <div
        className={cn(
          "mt-1 font-mono text-[18px] font-medium tabular-nums",
          accent ? "text-primary" : "text-foreground"
        )}
      >
        {value}
      </div>
    </div>
  );
}
