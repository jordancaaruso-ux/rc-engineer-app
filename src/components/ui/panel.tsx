import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Technical v2 shared panel vocabulary — the visual DNA that started on the
 * dashboard hero. Use these so every card/section reads as one designed system:
 * a mono uppercase eyebrow for section labels, and hairline-separated stat tiles
 * (JetBrains Mono, tabular) for numbers — the "instrument panel" feel.
 */

type Dot = "accent" | "gain" | "loss" | "muted";

function dotClass(dot: Dot): string {
  switch (dot) {
    case "gain":
      return "bg-[#4FD089]";
    case "loss":
      return "bg-[#E5644E]";
    case "muted":
      return "bg-faint";
    default:
      return "bg-primary";
  }
}

/** Card headline — same weight/style as the hero title, one step smaller. */
export function PanelTitle({
  children,
  className,
  as: Tag = "h2",
}: {
  children: ReactNode;
  className?: string;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <Tag
      className={cn(
        "text-[20px] font-extrabold leading-tight tracking-tight text-foreground sm:text-[22px]",
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
  dot,
  className,
}: {
  children: ReactNode;
  dot?: Dot;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {dot ? <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass(dot))} /> : null}
      <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-faint">{children}</span>
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
    <div className={cn("bg-[#17130f]/55 px-3 py-2.5", className)}>
      <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-faint">{label}</div>
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
