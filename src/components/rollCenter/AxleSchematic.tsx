"use client";

/**
 * Clean-schematic front-view suspension drawing for one axle (founder-picked style,
 * 2026-07-12): arms, knuckles, wheels, ground line, RC marker, and the true arm
 * angles labeled on the arms they measure. Deliberately NO instant-centre / force-line
 * construction rays — those belong to the Roll Center Lab (docs/ROLL_CENTER_NORTH_STAR.md).
 *
 * Draws directly from the engine's solved hardpoints, so what you see IS the solve
 * that produced the numbers. Shared by the setup-sheet geometry block and the Lab.
 * Accepts rolled solves (chassis-roll poses) and an optional GHOST axle — a second
 * solve drawn dashed underneath for two-setup comparison (yellow stays reserved for
 * the live RC marker; the ghost RC is a hollow outline).
 */

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { SolvedAxle, SolvedSide, Vec2 } from "@/lib/rollCenter/engine";

/** Visual tire section half-width (mm) — matches the ~19.5mm rubber on a TC. */
const TIRE_HALF_WIDTH = 9.8;
const VIEW_W = 360;

const armAngleDeg = (inner: Vec2, outer: Vec2): number =>
  (Math.atan2(outer.z - inner.z, outer.x - inner.x) * 180) / Math.PI;

/** Tire quad from contact + wheel-plane centre (leans with real camber). */
function tireCorners(side: SolvedSide): Vec2[] | null {
  const dx = side.wheelPlaneCentre.x - side.contact.x;
  const dz = side.wheelPlaneCentre.z - side.contact.z;
  const r = Math.hypot(dx, dz);
  if (r < 1) return null;
  const up = { x: dx / r, z: dz / r };
  const across = { x: up.z, z: -up.x };
  const top = { x: side.contact.x + up.x * 2 * r, z: side.contact.z + up.z * 2 * r };
  const w = TIRE_HALF_WIDTH;
  return [
    { x: side.contact.x - across.x * w, z: side.contact.z - across.z * w },
    { x: side.contact.x + across.x * w, z: side.contact.z + across.z * w },
    { x: top.x + across.x * w, z: top.z + across.z * w },
    { x: top.x - across.x * w, z: top.z - across.z * w },
  ];
}

type AxleDrawing = {
  tires: [Vec2[], Vec2[]];
  rc: Vec2;
};

function axleDrawing(solved: SolvedAxle): AxleDrawing | null {
  if (!solved.rollCentre) return null;
  const left = tireCorners(solved.left);
  const right = tireCorners(solved.right);
  if (!left || !right) return null;
  return { tires: [left, right], rc: solved.rollCentre };
}

/** Linkage lines for one axle: chassis bar, bulkheads, knuckles, arms. */
function LinkageLines({
  solved,
  X,
  Y,
  ghost,
}: {
  solved: SolvedAxle;
  X: (x: number) => number;
  Y: (z: number) => number;
  ghost?: boolean;
}) {
  const dash = ghost ? "4 3" : undefined;
  const o = (full: number) => (ghost ? full * 0.35 : full);
  return (
    <g>
      {/* Chassis plate between the lower-inner mounts + bulkhead posts */}
      <line
        x1={X(solved.left.innerLower.x)}
        y1={Y(solved.left.innerLower.z)}
        x2={X(solved.right.innerLower.x)}
        y2={Y(solved.right.innerLower.z)}
        stroke="currentColor"
        strokeOpacity={o(0.25)}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={dash}
      />
      {[solved.left, solved.right].map((s, i) => (
        <g key={`legs-${i}`}>
          <line
            x1={X(s.innerLower.x)}
            y1={Y(s.innerLower.z)}
            x2={X(s.innerUpper.x)}
            y2={Y(s.innerUpper.z)}
            stroke="currentColor"
            strokeOpacity={o(0.22)}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeDasharray={dash}
          />
          <line
            x1={X(s.lowerBall.x)}
            y1={Y(s.lowerBall.z)}
            x2={X(s.upperBall.x)}
            y2={Y(s.upperBall.z)}
            stroke="currentColor"
            strokeOpacity={o(0.4)}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeDasharray={dash}
          />
          <line
            x1={X(s.innerLower.x)}
            y1={Y(s.innerLower.z)}
            x2={X(s.lowerBall.x)}
            y2={Y(s.lowerBall.z)}
            stroke="currentColor"
            strokeOpacity={o(0.85)}
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={dash}
          />
          <line
            x1={X(s.innerUpper.x)}
            y1={Y(s.innerUpper.z)}
            x2={X(s.upperBall.x)}
            y2={Y(s.upperBall.z)}
            stroke="currentColor"
            strokeOpacity={o(0.85)}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeDasharray={dash}
          />
        </g>
      ))}
    </g>
  );
}

export function AxleSchematic({ solved, ghost, axleLabel, className }: {
  solved: SolvedAxle;
  /** Optional second solve drawn dashed underneath (two-setup ghost compare). */
  ghost?: SolvedAxle | null;
  /** For the accessible name, e.g. "front". */
  axleLabel?: string;
  className?: string;
}) {
  const d = useMemo(() => {
    const main = axleDrawing(solved);
    if (!main) return null;
    const gh = ghost ? axleDrawing(ghost) : null;

    const allTires = [...main.tires.flat(), ...(gh ? gh.tires.flat() : [])];
    const tireTopZ = Math.max(...allTires.map((p) => p.z));
    const contacts = [solved.left.contact.x, solved.right.contact.x].concat(
      ghost ? [ghost.left.contact.x, ghost.right.contact.x] : []
    );
    const rcZs = [main.rc.z, ...(gh ? [gh.rc.z] : [])];
    const xMin = Math.min(...contacts) - 16;
    const xMax = Math.max(...contacts) + 16;
    const zMin = Math.min(0, ...rcZs) - 8;
    const zMax = Math.max(tireTopZ, solved.right.innerUpper.z) + 5;

    const S = VIEW_W / (xMax - xMin);
    // Quantize every rendered coordinate: Node and browser libm differ by 1 ulp on
    // trig/hypot, which otherwise trips React hydration on SSR'd SVG attributes.
    const q = (n: number) => Math.round(n * 100) / 100;
    const H = q((zMax - zMin) * S);
    const X = (x: number) => q((x - xMin) * S);
    const Y = (z: number) => q((zMax - z) * S);
    const P = (p: Vec2) => `${X(p.x).toFixed(1)},${Y(p.z).toFixed(1)}`;

    const r = solved.right;
    const lowerMid = { x: (r.innerLower.x + r.lowerBall.x) / 2, z: (r.innerLower.z + r.lowerBall.z) / 2 };
    const upperMid = { x: (r.innerUpper.x + r.upperBall.x) / 2, z: (r.innerUpper.z + r.upperBall.z) / 2 };

    return {
      H,
      X,
      Y,
      P,
      main,
      gh,
      lowerAngle: armAngleDeg(r.innerLower, r.lowerBall),
      upperAngle: armAngleDeg(r.innerUpper, r.upperBall),
      lowerMid,
      upperMid,
    };
  }, [solved, ghost]);

  if (!d) return null;

  const joints: Vec2[] = [solved.left, solved.right].flatMap((s) => [
    s.innerLower,
    s.innerUpper,
    s.lowerBall,
    s.upperBall,
  ]);

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${d.H.toFixed(1)}`}
      className={cn("w-full font-mono", className)}
      role="img"
      aria-label={`${axleLabel ?? "axle"} suspension schematic, roll center ${d.main.rc.z.toFixed(1)}mm`}
    >
      {/* Ground + car centerline */}
      <line x1={0} y1={d.Y(0)} x2={VIEW_W} y2={d.Y(0)} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1} />
      <line
        x1={d.X(0)}
        y1={8}
        x2={d.X(0)}
        y2={d.H - 4}
        stroke="currentColor"
        strokeOpacity={0.12}
        strokeWidth={1}
        strokeDasharray="3 4"
      />

      {/* Ghost setup (dashed, faint) under the live one */}
      {ghost && d.gh && (
        <g aria-hidden="true">
          {d.gh.tires.map((corners, i) => (
            <polygon
              key={`ghost-tire-${i}`}
              points={corners.map(d.P).join(" ")}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.18}
              strokeWidth={1}
              strokeDasharray="4 3"
              strokeLinejoin="round"
            />
          ))}
          <LinkageLines solved={ghost} X={d.X} Y={d.Y} ghost />
          <rect
            x={d.X(d.gh.rc.x) - 3.4}
            y={d.Y(d.gh.rc.z) - 3.4}
            width={6.8}
            height={6.8}
            transform={`rotate(45 ${d.X(d.gh.rc.x)} ${d.Y(d.gh.rc.z)})`}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.45}
            strokeWidth={1.2}
          />
        </g>
      )}

      {/* Tires (lean with real camber) */}
      {d.main.tires.map((corners, i) => (
        <polygon
          key={`tire-${i}`}
          points={corners.map(d.P).join(" ")}
          fill="currentColor"
          fillOpacity={0.07}
          stroke="currentColor"
          strokeOpacity={0.35}
          strokeWidth={1}
          strokeLinejoin="round"
        />
      ))}

      <LinkageLines solved={solved} X={d.X} Y={d.Y} />

      {/* Pivots + balls */}
      {joints.map((p, i) => (
        <circle key={`joint-${i}`} cx={d.X(p.x)} cy={d.Y(p.z)} r={2.6} fill="currentColor" fillOpacity={0.85} />
      ))}

      {/* Arm angles, labeled on the arms they measure (right side) */}
      <text
        x={d.X(d.lowerMid.x)}
        y={d.Y(d.lowerMid.z - 4.8)}
        textAnchor="middle"
        fontSize={9}
        fill="currentColor"
        fillOpacity={0.7}
      >
        {d.lowerAngle.toFixed(1)}°
      </text>
      <text
        x={d.X(d.upperMid.x)}
        y={d.Y(d.upperMid.z + 4.2)}
        textAnchor="middle"
        fontSize={9}
        fill="currentColor"
        fillOpacity={0.7}
      >
        {d.upperAngle.toFixed(1)}°
      </text>

      {/* Roll center — the one yellow mark (marker only; doc's visual rule) */}
      <g className="text-primary">
        <rect
          x={d.X(d.main.rc.x) - 3.4}
          y={d.Y(d.main.rc.z) - 3.4}
          width={6.8}
          height={6.8}
          transform={`rotate(45 ${d.X(d.main.rc.x)} ${d.Y(d.main.rc.z)})`}
          fill="currentColor"
        />
      </g>
      <text
        x={d.X(d.main.rc.x)}
        y={d.Y(d.main.rc.z - 5.2) + 4}
        textAnchor="middle"
        fontSize={9.5}
        fill="currentColor"
        fillOpacity={0.9}
      >
        RC {d.main.rc.z >= 0 ? "+" : ""}{d.main.rc.z.toFixed(1)}mm
      </text>
    </svg>
  );
}
