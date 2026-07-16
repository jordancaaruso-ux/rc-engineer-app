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
        "hub-row-title text-[13px] text-foreground",
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
    <div className={cn("eyebrow-root mb-2 flex items-center", className)}>
      <span className="eyebrow-label">{children}</span>
    </div>
  );
}

/**
 * Hairline-separated container for StatTile cells (instrument-panel strip).
 *
 * The strip *itself* carries the translucent `/45` glass fill — the exact same
 * surface as the pace/Today strips — so every cell shows `/45` composited
 * directly over the card, never over an opaque divider plane. That keeps the
 * cell shade pixel-identical to the standalone strips. Dividers are drawn as
 * top/left cell borders (see `StatTile`); the inner grid is offset by 1px so the
 * outer cells' borders tuck under the frame, leaving single interior hairlines
 * that stay correct even when the grid wraps (e.g. a 2×2 metric block).
 *
 * @param gridClassName grid-template classes for the cells (`grid-cols-3`, …).
 * @param className spacing / positioning for the strip frame (`mt-3`, …).
 */
export function StatStrip({
  children,
  className,
  gridClassName,
}: {
  children: ReactNode;
  className?: string;
  gridClassName?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-background/45",
        className
      )}
    >
      <div className={cn("grid -ml-px -mt-px", gridClassName)}>{children}</div>
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
    <div className={cn("border-l border-t border-border px-3 py-2.5", className)}>
      {/* Fixed 2-line label box: a wrapping label (e.g. "Time driving") no longer
          pushes its value down, so every tile's value sits on the same baseline
          across the strip — even in a grid-cols-3 cell. */}
      <div className="type-data-label line-clamp-2 min-h-[2.6em] leading-[1.3]">{label}</div>
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
