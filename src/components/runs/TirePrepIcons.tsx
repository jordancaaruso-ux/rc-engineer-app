import { cn } from "@/lib/utils";

/**
 * Custom tire-prep glyphs (founder-approved via design artifact, 2026-07-14).
 * Drawn to Phosphor stroke conventions (1.8 / round caps) so they sit beside the
 * app's icon set. All inherit `currentColor`; size via className (h-* w-*).
 *
 *   AdditiveDropIcon — drop landing on the tire arc ("sauce applied")
 *   WarmerSteamIcon  — tire with strictly vertical steam ("in the warmers")
 *   TowelRollIcon    — paper-towel roll w/ trailing sheet ("towels in the cups")
 */

type IconProps = { className?: string };

function baseProps(className?: string) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
    className: cn("shrink-0", className),
  };
}

export function AdditiveDropIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <path d="M12 3.2 C12 3.2 9.2 6.7 9.2 8.6 a2.8 2.8 0 0 0 5.6 0 C14.8 6.7 12 3.2 12 3.2 Z" />
      <path d="M4.5 20.5 a7.6 7.6 0 0 1 15 0" />
      <path d="M8.4 14.4 l-1.5 -1.2 M15.6 14.4 l1.5 -1.2" opacity={0.55} />
    </svg>
  );
}

export function WarmerSteamIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <circle cx="12" cy="16.4" r="5.1" />
      <circle cx="12" cy="16.4" r="2.5" opacity={0.5} />
      <path d="M8 9.6 c-0.9 -1 0.9 -2.1 0 -3.1 c-0.9 -1 0.9 -2.1 0 -3.1" />
      <path d="M12 9.6 c-0.9 -1 0.9 -2.1 0 -3.1 c-0.9 -1 0.9 -2.1 0 -3.1" />
      <path d="M16 9.6 c-0.9 -1 0.9 -2.1 0 -3.1 c-0.9 -1 0.9 -2.1 0 -3.1" />
    </svg>
  );
}

export function TowelRollIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <ellipse cx="10" cy="6.2" rx="4.6" ry="2.4" />
      <path d="M5.4 6.2 v10 c0 1.3 2.1 2.4 4.6 2.4 c2.5 0 4.6 -1.1 4.6 -2.4 v-10" />
      <ellipse cx="10" cy="6.2" rx="1.4" ry="0.8" opacity={0.55} />
      <path d="M14.6 9 h4 v10.4 h-4.3" opacity={0.85} />
    </svg>
  );
}
