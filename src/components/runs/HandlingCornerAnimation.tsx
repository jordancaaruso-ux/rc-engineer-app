"use client";

import { useId, useMemo } from "react";
import type { CornerPhase, HandlingIntensity1to5, PhaseBalance } from "@/lib/runHandlingAssessment";

function phaseT(phase: CornerPhase): number {
  switch (phase) {
    case "entry":
      return 0.22;
    case "mid":
      return 0.5;
    case "exit":
      return 0.78;
    default:
      return 0.5;
  }
}

function bezierPointAndTangent(
  t: number,
  p0: [number, number],
  p1: [number, number],
  p2: [number, number]
): { x: number; y: number; tangentDeg: number } {
  const u = 1 - t;
  const x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0];
  const y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1];
  const dx = 2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
  const dy = 2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
  return { x, y, tangentDeg: (Math.atan2(dy, dx) * 180) / Math.PI };
}

const HAIRPIN = {
  seg1: {
    p0: [22, 100] as [number, number],
    p1: [22, 44] as [number, number],
    p2: [60, 18] as [number, number],
  },
  seg2: {
    p0: [60, 18] as [number, number],
    p1: [98, 44] as [number, number],
    p2: [98, 100] as [number, number],
  },
};

function hairpinPointAndTangent(t: number): { x: number; y: number; tangentDeg: number } {
  const tClamped = Math.min(1, Math.max(0, t));
  if (tClamped < 0.5) {
    const u = tClamped * 2;
    return bezierPointAndTangent(u, HAIRPIN.seg1.p0, HAIRPIN.seg1.p1, HAIRPIN.seg1.p2);
  }
  const u = (tClamped - 0.5) * 2;
  return bezierPointAndTangent(u, HAIRPIN.seg2.p0, HAIRPIN.seg2.p1, HAIRPIN.seg2.p2);
}

const PATH_D = `M ${HAIRPIN.seg1.p0[0]} ${HAIRPIN.seg1.p0[1]} Q ${HAIRPIN.seg1.p1[0]} ${HAIRPIN.seg1.p1[1]} ${HAIRPIN.seg1.p2[0]} ${HAIRPIN.seg1.p2[1]} Q ${HAIRPIN.seg2.p1[0]} ${HAIRPIN.seg2.p1[1]} ${HAIRPIN.seg2.p2[0]} ${HAIRPIN.seg2.p2[1]}`;

/** |balance| 1…3 → animation strength (1–5 scale). */
function balanceToIntensity(balance: PhaseBalance): HandlingIntensity1to5 {
  const a = Math.abs(balance);
  if (a === 0) return 2;
  if (a === 1) return 2;
  if (a === 2) return 3;
  return 5;
}

function intensityFactors(intensity: HandlingIntensity1to5): { slip: number; drift: number; duration: number } {
  const t = (Math.min(5, Math.max(1, intensity)) - 1) / 4;
  const mild = { slip: 4, drift: 1.8, duration: 2.8 };
  const strong = { slip: 15, drift: 7, duration: 1.95 };
  return {
    slip: mild.slip + t * (strong.slip - mild.slip),
    drift: mild.drift + t * (strong.drift - mild.drift),
    duration: mild.duration + t * (strong.duration - mild.duration),
  };
}

/**
 * Small hairpin schematic for one corner phase. `balance` is −3 (push) … +3 (oversteer).
 */
export function HandlingCornerAnimation({
  phase,
  balance,
}: {
  phase: CornerPhase;
  balance: PhaseBalance;
}) {
  const uid = useId().replace(/:/g, "");
  const t = phaseT(phase);
  const { x, y, tangentDeg } = useMemo(() => hairpinPointAndTangent(t), [t]);

  const mode = balance === 0 ? "neutral" : balance < 0 ? "understeer" : "oversteer";
  const intensity = balanceToIntensity(balance);
  const slipSign = mode === "understeer" ? 1 : mode === "oversteer" ? -1 : 0;
  const { slip, drift, duration } =
    mode === "neutral" ? { slip: 2, drift: 0.8, duration: 3.2 } : intensityFactors(intensity);

  const carRotation = tangentDeg - slipSign * slip;
  const rotPulse = slipSign * 3;
  const tx0 = slipSign * drift * 0.35;
  const tx1 = slipSign * drift;

  const label =
    mode === "neutral"
      ? `Schematic: neutral at ${phase} hairpin`
      : mode === "understeer"
        ? `Schematic: understeer (${balance}) at ${phase} hairpin — nose pushes wide`
        : `Schematic: oversteer (+${balance}) at ${phase} hairpin — rear steps out`;

  return (
    <div
      className="relative w-full max-w-[200px] rounded-md border border-border/60 bg-card/80 overflow-hidden shadow-sm"
      role="img"
      aria-label={label}
    >
      <style>{`
        @keyframes handling-sway-${uid} {
          0%, 100% {
            transform: rotate(${carRotation}deg) translate(${tx0}px, 0px);
          }
          50% {
            transform: rotate(${carRotation + rotPulse}deg) translate(${tx1}px, -1px);
          }
        }
        .handling-sway-${uid} {
          animation: handling-sway-${uid} ${duration}s ease-in-out infinite;
          transform-origin: 0px 0px;
          transform-box: fill-box;
        }
        @media (prefers-reduced-motion: reduce) {
          .handling-sway-${uid} {
            animation: none !important;
            transform: rotate(${carRotation}deg) translate(${tx0}px, 0px);
          }
        }
      `}</style>
      <svg viewBox="0 0 120 120" className="w-full h-auto block text-muted-foreground" aria-hidden>
        <ellipse cx={60} cy={38} rx={28} ry={22} fill="currentColor" opacity={0.06} />
        <path
          d={PATH_D}
          fill="none"
          stroke="currentColor"
          strokeWidth={7}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.2}
        />
        <path
          d={PATH_D}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.45}
        />
        <g transform={`translate(${x}, ${y})`}>
          <g className={`text-foreground handling-sway-${uid}`}>
            <rect x={-11} y={-6} width={22} height={12} rx={3.5} fill="currentColor" opacity={0.9} />
            <polygon points="11,0 19,-4 19,4" fill="currentColor" />
          </g>
        </g>
      </svg>
      <div className="px-2 pb-2 pt-0 text-[9px] text-muted-foreground text-center leading-tight">
        {mode === "neutral" ? "Neutral" : mode === "understeer" ? "Push" : "Tail out"} · {phase} ·{" "}
        {balance === 0 ? "0" : balance > 0 ? `+${balance}` : balance}
      </div>
    </div>
  );
}
