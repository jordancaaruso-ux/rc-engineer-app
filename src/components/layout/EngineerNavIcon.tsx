"use client";

import { useId } from "react";
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
  /** Brightens to full electric-gold when the nav item is selected. */
  active?: boolean;
};

/**
 * Engineer nav mark: a refined gold spark cluster (one large spark + two
 * companions). Restrained electric-yellow → amber gradient — deliberately no
 * rainbow — so the signature feature reads premium and on-palette across both
 * nav surfaces. Calms to a softer opacity when its tab is not selected.
 */
export function EngineerNavIcon({ className, active = false }: EngineerNavIconProps) {
  const gradientId = useId().replace(/:/g, "");
  const fill = `url(#${gradientId})`;

  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("h-5 w-5 shrink-0", className)}
      aria-hidden
    >
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1="4"
          y1="3"
          x2="20"
          y2="21"
        >
          <stop offset="0%" stopColor="#FFE9A8" />
          <stop offset="46%" stopColor="#FFD60A" />
          <stop offset="100%" stopColor="#DE9326" />
        </linearGradient>
      </defs>
      <g className={active ? "opacity-100" : "opacity-[0.74] transition-opacity duration-150"}>
        <path d={sparklePath(9, 13.4, 6.8)} fill={fill} />
        <path d={sparklePath(17.6, 7, 3.3)} fill={fill} opacity={0.92} />
        <path d={sparklePath(19.4, 15.8, 2.2)} fill={fill} opacity={0.8} />
      </g>
    </svg>
  );
}
