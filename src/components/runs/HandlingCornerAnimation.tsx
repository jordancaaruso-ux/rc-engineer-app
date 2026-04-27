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

/** 180° hairpin: chute in → semicircle arc (constant radius) → chute out. C = (60, 50), R = 35. */
const CX = 60;
const CY = 50;
const R = 35;
const ENTRY_X = 25;
const EXIT_X = 95;
const TURN_T = Math.PI; /* semicircle */

const L1 = 50; /* (25,100) → (25,50) */
const L2 = R * TURN_T;
const L3 = 50; /* (95,50) → (95,100) */
const L_TOTAL = L1 + L2 + L3;

const PATH_D = `M 25 100 L 25 50 A 35 35 0 1 1 95 50 L 95 100`;

/**
 * t ∈ [0,1] is normalized distance along the centerline (entry → top of U → exit).
 * Semicircle uses θ: π → 0 so the bend opens downward (U points toward +y on screen).
 */
function hairpinPointAndTangent(t: number): { x: number; y: number; tangentDeg: number } {
  const u = Math.min(1, Math.max(0, t));
  const s = u * L_TOTAL;
  if (s <= L1) {
    const p = s / L1; /* 0 at bottom, 1 at (25,50) */
    const y = 100 - p * 50;
    return { x: ENTRY_X, y, tangentDeg: -90 };
  }
  if (s <= L1 + L2) {
    const sa = s - L1;
    const p = sa / L2; /* 0..1 along 180° arc (left → over top → right) */
    const theta = Math.PI * (1 - p);
    const x = CX + R * Math.cos(theta);
    const y = CY - R * Math.sin(theta);
    const dxDtheta = -R * Math.sin(theta);
    const dyDtheta = -R * Math.cos(theta);
    return { x, y, tangentDeg: (Math.atan2(dyDtheta, dxDtheta) * 180) / Math.PI };
  }
  const s3 = s - L1 - L2;
  const p = s3 / L3;
  const y = 50 + p * 50;
  return { x: EXIT_X, y, tangentDeg: 90 };
}

function sampleCenterline(n: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = n <= 1 ? 0.5 : i / (n - 1);
    const { x, y } = hairpinPointAndTangent(t);
    out.push({ x, y });
  }
  return out;
}

function pathFromPoints(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)}`;
  return d;
}

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
  const mild = { slip: 4, drift: 1.8, duration: 2.8 };
  const strong = { slip: 15, drift: 7, duration: 1.95 };
  return {
    slip: mild.slip + t * (strong.slip - mild.slip),
    drift: mild.drift + t * (strong.drift - mild.drift),
    duration: mild.duration + t * (strong.duration - mild.duration),
  };
}

/**
 * 180° hairpin (rounded arc, not a cusp), G→Y→O line, boomerang “sway” for balance.
 */
export function HandlingCornerAnimation({ phase, balance }: { phase: CornerPhase; balance: PhaseBalance }) {
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

  const { dEntry, dMid, dExit } = useMemo(() => {
    const samples = sampleCenterline(64);
    const third = Math.max(1, Math.floor(samples.length / 3));
    const pEntry = samples.slice(0, third + 1);
    const pMid = samples.slice(third, 2 * third + 1);
    const pExit = samples.slice(2 * third);
    return {
      dEntry: pathFromPoints(pEntry),
      dMid: pathFromPoints(pMid),
      dExit: pathFromPoints(pExit),
    };
  }, []);

  return (
    <div
      className="relative w-full max-w-[220px] rounded-lg border border-border/50 overflow-hidden shadow-sm"
      role="img"
      aria-label={label}
    >
      <style>{`
        @keyframes handling-sway-${uid} {
          0%,
          100% {
            transform: rotate(${carRotation}deg) translate(${tx0}px, 0px);
          }
          50% {
            transform: rotate(${carRotation + rotPulse}deg) translate(${tx1}px, -1px);
          }
        }
        .handling-sway-${uid} {
          animation: handling-sway-${uid} ${duration}s ease-in-out infinite;
          transform-origin: 0 0;
          transform-box: fill-box;
        }
        @media (prefers-reduced-motion: reduce) {
          .handling-sway-${uid} {
            animation: none !important;
            transform: rotate(${carRotation}deg) translate(${tx0}px, 0px);
          }
        }
        @keyframes handling-smoke-${uid} {
          0%,
          100% {
            opacity: 0.35;
          }
          50% {
            opacity: 0.6;
          }
        }
        .handling-smoke-${uid} {
          animation: handling-smoke-${uid} 1.6s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .handling-smoke-${uid} {
            animation: none;
            opacity: 0.45;
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
          d={PATH_D}
          fill="none"
          stroke={WHITE_EDGE}
          strokeWidth="22"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={PATH_D}
          fill="none"
          stroke={ASPHALT}
          strokeWidth="18"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={PATH_D}
          fill="none"
          stroke={ASPHALT_INNER}
          strokeWidth="10"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.5}
        />
        {dEntry ? (
          <path
            d={dEntry}
            fill="none"
            stroke={LINE_ENTRY}
            strokeWidth="1.6"
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
            strokeWidth="1.6"
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
            strokeWidth="1.6"
            strokeDasharray="2.5 2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.95}
          />
        ) : null}
        <g transform={`translate(${x}, ${y})`}>
          <g className={`handling-sway-${uid}`} style={{ color: "inherit" }}>
            <g>
              <rect
                x={-12}
                y={-5.5}
                width={20}
                height={11}
                rx={2.2}
                fill="#e8a0bc"
                stroke="#b8557a"
                strokeWidth="0.6"
              />
              <polygon
                points="8,-2.2 16,-0.1 8,1.1"
                fill="#e8a0bc"
                stroke="#b8557a"
                strokeWidth="0.45"
              />
              <rect
                x={-14.5}
                y={-4}
                width={2.2}
                height={8}
                rx={0.3}
                fill="#1a1d1c"
              />
              <circle r="3.4" fill="#d4a524" />
              <text
                x="0"
                y="1.2"
                textAnchor="middle"
                className="select-none"
                fill="#1a1510"
                style={{ fontSize: "3.2px", fontWeight: 700, fontFamily: "system-ui, sans-serif" }}
              >
                5
              </text>
              {mode === "oversteer" && (
                <g
                  className={`handling-smoke-${uid}`}
                  style={{ mixBlendMode: "screen" }}
                  opacity={0.45}
                  aria-hidden
                >
                  <ellipse
                    transform="translate(-9,2) rotate(18)"
                    cx="0"
                    cy="0"
                    rx="4.5"
                    ry="1.3"
                    fill="white"
                  />
                  <ellipse
                    transform="translate(-11,3) rotate(12)"
                    cx="0"
                    cy="0"
                    rx="3"
                    ry="0.8"
                    fill="white"
                  />
                </g>
              )}
            </g>
          </g>
        </g>
      </svg>
      <div className="px-2 pb-2.5 pt-0 text-[9px] text-muted-foreground text-center leading-tight bg-card/30 border-t border-border/30">
        {mode === "neutral" ? "Neutral" : mode === "understeer" ? "Push" : "Tail out"} · {phase} ·{" "}
        {balance === 0 ? "0" : balance > 0 ? `+${balance}` : balance}
        <div className="text-[8px] opacity-80 mt-0.5">Line: entry → mid → exit</div>
      </div>
    </div>
  );
}
