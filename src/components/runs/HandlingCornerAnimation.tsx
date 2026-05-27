"use client";

import { useId, useMemo } from "react";
import type { CornerPhase, HandlingIntensity1to5, PhaseBalance } from "@/lib/runHandlingAssessment";
import {
  HAIRPIN_PATH_D,
  hairpinPointAndTangent,
  pathFromPoints,
  phaseT,
  sampleCenterline,
  slipOffsetUnit,
} from "@/components/runs/handlingCornerGeometry";
import { HandlingTouringCarSilhouette } from "@/components/runs/HandlingTouringCarSilhouette";

const GRASS = "#3d5c42";
const ASPHALT = "#2a2e2c";
const ASPHALT_INNER = "#3a3f3c";
const WHITE_EDGE = "#f0f2f0";
const LINE_ENTRY = "#22c55e";
const LINE_MID = "#eab308";
const LINE_EXIT = "#f97316";

function balanceToIntensity(balance: PhaseBalance): HandlingIntensity1to5 {
  const a = Math.abs(balance);
  if (a === 0) return 2;
  if (a === 1) return 2;
  if (a === 2) return 3;
  return 5;
}

function intensityFactors(intensity: HandlingIntensity1to5): { slip: number; drift: number; duration: number } {
  const t = (Math.min(5, Math.max(1, intensity)) - 1) / 4;
  const mild = { slip: 3.5, drift: 1.4, duration: 2.9 };
  const strong = { slip: 11, drift: 5.5, duration: 2.1 };
  return {
    slip: mild.slip + t * (strong.slip - mild.slip),
    drift: mild.drift + t * (strong.drift - mild.drift),
    duration: mild.duration + t * (strong.duration - mild.duration),
  };
}

/**
 * 180° hairpin schematic with 1/10 touring top-down car; sway shows push vs tail-out.
 */
export function HandlingCornerAnimation({ phase, balance }: { phase: CornerPhase; balance: PhaseBalance }) {
  const uid = useId().replace(/:/g, "");
  const t = phaseT(phase);
  const { x, y, tangentDeg } = useMemo(() => hairpinPointAndTangent(t), [t]);

  const mode = balance === 0 ? "neutral" : balance < 0 ? "understeer" : "oversteer";
  const intensity = balanceToIntensity(balance);
  const slipSign = mode === "understeer" ? 1 : mode === "oversteer" ? -1 : 0;
  const { slip, drift, duration } =
    mode === "neutral" ? { slip: 1.5, drift: 0.5, duration: 3.4 } : intensityFactors(intensity);

  const { ox, oy } = slipOffsetUnit(tangentDeg, mode);
  const carRotation = tangentDeg - slipSign * slip;
  const rotPulse = slipSign * 2.5;
  const drift0 = drift * 0.4;
  const drift1 = drift;
  const tx0 = ox * drift0;
  const ty0 = oy * drift0;
  const tx1 = ox * drift1;
  const ty1 = oy * drift1;

  const tangentRad = (tangentDeg * Math.PI) / 180;
  const idealLen = 9;
  const idealX2 = Math.cos(tangentRad) * idealLen;
  const idealY2 = Math.sin(tangentRad) * idealLen;

  const label =
    mode === "neutral"
      ? `Neutral balance at ${phase} of hairpin corner`
      : mode === "understeer"
        ? `Understeer ${balance} at ${phase}: nose pushes wide on hairpin`
        : `Oversteer plus ${balance} at ${phase}: rear steps out on hairpin`;

  const { dEntry, dMid, dExit } = useMemo(() => {
    const samples = sampleCenterline(64);
    const third = Math.max(1, Math.floor(samples.length / 3));
    return {
      dEntry: pathFromPoints(samples.slice(0, third + 1)),
      dMid: pathFromPoints(samples.slice(third, 2 * third + 1)),
      dExit: pathFromPoints(samples.slice(2 * third)),
    };
  }, []);

  return (
    <div
      className="relative w-full max-w-[min(100%,360px)] rounded-lg border border-border/50 overflow-hidden shadow-sm"
      role="img"
      aria-label={label}
    >
      <style>{`
        @keyframes handling-sway-${uid} {
          0%,
          100% {
            transform: rotate(${carRotation}deg) translate(${tx0}, ${ty0});
          }
          50% {
            transform: rotate(${carRotation + rotPulse}deg) translate(${tx1}, ${ty1});
          }
        }
        .handling-sway-${uid} {
          animation: handling-sway-${uid} ${duration}s ease-in-out infinite;
          transform-origin: center;
          transform-box: fill-box;
        }
        @media (prefers-reduced-motion: reduce) {
          .handling-sway-${uid} {
            animation: none !important;
            transform: rotate(${carRotation}deg) translate(${tx0}, ${ty0});
          }
        }
      `}</style>
      <svg viewBox="0 0 120 120" className="w-full h-auto block" aria-hidden>
        <rect width="120" height="120" fill={GRASS} />
        <rect x="0" y="0" width="120" height="120" fill={`url(#rf-${uid})`} opacity={0.12} />
        <defs>
          <radialGradient id={`rf-${uid}`} cx="50%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#000" stopOpacity={0} />
          </radialGradient>
        </defs>
        <path
          d={HAIRPIN_PATH_D}
          fill="none"
          stroke={WHITE_EDGE}
          strokeWidth="20"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={HAIRPIN_PATH_D}
          fill="none"
          stroke={ASPHALT}
          strokeWidth="16"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={HAIRPIN_PATH_D}
          fill="none"
          stroke={ASPHALT_INNER}
          strokeWidth="9"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.45}
        />
        {dEntry ? (
          <path
            d={dEntry}
            fill="none"
            stroke={LINE_ENTRY}
            strokeWidth="1.5"
            strokeDasharray="2.5 2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.95}
          />
        ) : null}
        {dMid ? (
          <path
            d={dMid}
            fill="none"
            stroke={LINE_MID}
            strokeWidth="1.5"
            strokeDasharray="2.5 2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.95}
          />
        ) : null}
        {dExit ? (
          <path
            d={dExit}
            fill="none"
            stroke={LINE_EXIT}
            strokeWidth="1.5"
            strokeDasharray="2.5 2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.95}
          />
        ) : null}
        <circle cx={x} cy={y} r={0.9} fill="#f0f2f0" opacity={0.35} />
        <g transform={`translate(${x}, ${y})`}>
          {mode === "understeer" ? (
            <line
              x1={0}
              y1={0}
              x2={idealX2}
              y2={idealY2}
              stroke="#f0f2f0"
              strokeWidth={0.7}
              strokeDasharray="1.5 1.5"
              opacity={0.4}
            />
          ) : null}
          <g className={`handling-sway-${uid}`}>
            <HandlingTouringCarSilhouette showRearSmear={mode === "oversteer"} />
          </g>
        </g>
      </svg>
      <div className="px-2 pb-2.5 pt-0 text-[9px] text-muted-foreground text-center leading-tight bg-card/30 border-t border-border/30">
        {mode === "neutral" ? "Neutral" : mode === "understeer" ? "Push wide" : "Tail out"} · {phase} ·{" "}
        {balance === 0 ? "0" : balance > 0 ? `+${balance}` : balance}
        <div className="text-[8px] opacity-80 mt-0.5">
          {mode === "understeer"
            ? "Dashed line: ideal path · car shows push wide"
            : mode === "oversteer"
              ? "Car shows tail-out vs corner line"
              : "Line colours: entry → mid → exit"}
        </div>
      </div>
    </div>
  );
}
