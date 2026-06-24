"use client";

import { cn } from "@/lib/utils";

/**
 * 4-point "spark" with gently concave (curved) sides — the refined silhouette
 * used on premium AI/assistant marks rather than a hard straight-edged diamond.
 * `r` is the outer radius; `waist` controls how sharp the points are
 * (smaller = pointier / deeper concave curve).
 */
function sparklePath(cx: number, cy: number, r: number): string {
  const w = r * 0.16;
  return [
    `M ${cx} ${cy - r}`,
    `Q ${cx + w} ${cy - w} ${cx + r} ${cy}`,
    `Q ${cx + w} ${cy + w} ${cx} ${cy + r}`,
    `Q ${cx - w} ${cy + w} ${cx - r} ${cy}`,
    `Q ${cx - w} ${cy - w} ${cx} ${cy - r}`,
    "Z",
  ].join(" ");
}

type EngineerNavIconProps = {
  className?: string;
  /** Heavier stroke when tab is active (matches Lucide active weight). */
  active?: boolean;
};

function sparkleStroke(active?: boolean) {
  return {
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: active ? 2.25 : 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

/**
 * Engineer nav mark: outline spark cluster (one large spark + two companions).
 * Stroke-only so it inherits nav link color — muted when inactive, foreground
 * when active — matching Lucide icons in the bottom bar and sidebar.
 */
export function EngineerNavIcon({ className, active }: EngineerNavIconProps) {
  const stroke = sparkleStroke(active);
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("h-[22px] w-[22px] shrink-0", className)}
      aria-hidden
    >
      <path d={sparklePath(9, 13.4, 6.8)} {...stroke} />
      <path d={sparklePath(17.6, 7, 3.3)} {...stroke} />
      <path d={sparklePath(19.4, 15.8, 2.2)} {...stroke} />
    </svg>
  );
}
