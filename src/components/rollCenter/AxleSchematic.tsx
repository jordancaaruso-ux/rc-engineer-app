"use client";

/**
 * Clean-schematic front-view suspension drawing for one axle (founder-picked style,
 * 2026-07-12): arms, knuckles, wheels, ground line, RC marker, and the true arm
 * angles labeled on the arms they measure. Deliberately NO instant-centre / force-line
 * construction rays — those belong to the Geometry Lab (docs/ROLL_CENTER_NORTH_STAR.md).
 *
 * Draws directly from the engine's solved hardpoints, so what you see IS the solve
 * that produced the numbers. Shared by the setup-sheet geometry block and the Lab.
 * Accepts rolled solves (chassis-roll poses) and an optional GHOST axle — a second
 * solve drawn dotted underneath for two-setup comparison (yellow stays reserved for
 * the live RC marker; the ghost RC is the same dot, hollow).
 */

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { SolvedAxle, SolvedSide, Vec2 } from "@/lib/rollCenter/engine";

/** Visual tire section half-width (mm) — matches the ~19.5mm rubber on a TC. */
const TIRE_HALF_WIDTH = 9.8;
const VIEW_W = 360;
/** Roll-centre marker radius — live is filled yellow, ghost is the same size, hollow. */
const RC_DOT_R = 2;
/** How close a pinned (off-scale) roll-centre marker may sit to the frame edge. */
const RC_EDGE_PAD = 5;
/**
 * How far below the ground line the frame always reaches, in mm. FIXED on purpose: this is
 * the floor of the drawing, and anything that moves with the setup would resize the car every
 * time a knob turned. 20mm covers the roll centres these cars actually run (measured -9.1mm
 * front / -8.5mm rear on the blank A800 car); a lower one still shows, pinned and off-scale.
 */
const RC_WINDOW_BELOW_MM = 20;

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

/**
 * Live stroke weights per member (founder-picked 2026-08-13 off the stroke study).
 * Thin and fully opaque: sharpness comes from narrow near-solid lines, never from a
 * lighter colour — these draw in `currentColor`, which is warm ink on light paper.
 */
const LIVE_STROKE = {
  chassis: 0.9,
  post: 0.8,
  knuckle: 0.7,
  lower: 0.6,
  upper: 0.5,
} as const;

/**
 * The ghost carries its own flat weight rather than a scaled copy of the live one.
 * Scaling used to multiply every live opacity by 0.35, which dropped the chassis plate
 * (0.25) to 0.09 and made it invisible; a flat value keeps every member equally legible.
 */
const GHOST_STROKE = 0.9;
const GHOST_OPACITY = 0.65;
const GHOST_DASH = "1 3";

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
  const line = (a: Vec2, b: Vec2, width: number, key: string) => (
    <line
      key={key}
      x1={X(a.x)}
      y1={Y(a.z)}
      x2={X(b.x)}
      y2={Y(b.z)}
      stroke="currentColor"
      strokeOpacity={ghost ? GHOST_OPACITY : 1}
      strokeWidth={ghost ? GHOST_STROKE : width}
      strokeLinecap="round"
      strokeDasharray={ghost ? GHOST_DASH : undefined}
    />
  );
  return (
    <g>
      {/* Chassis plate between the lower-inner mounts + bulkhead posts */}
      {line(solved.left.innerLower, solved.right.innerLower, LIVE_STROKE.chassis, "chassis")}
      {[solved.left, solved.right].map((s, i) => (
        <g key={`legs-${i}`}>
          {line(s.innerLower, s.innerUpper, LIVE_STROKE.post, "post")}
          {line(s.lowerBall, s.upperBall, LIVE_STROKE.knuckle, "knuckle")}
          {line(s.innerLower, s.lowerBall, LIVE_STROKE.lower, "lower")}
          {line(s.innerUpper, s.upperBall, LIVE_STROKE.upper, "upper")}
        </g>
      ))}
    </g>
  );
}

export function AxleSchematic({ solved, ghost, extraPoints, fitBox, axleLabel, showCamber, className }: {
  solved: SolvedAxle;
  /** Optional second solve drawn dashed underneath (two-setup ghost compare). */
  ghost?: SolvedAxle | null;
  /**
   * Extra points folded into the VERTICAL view extents but not drawn — the Lab passes the
   * roll-sweep RC path and both ends of the bump travel, so the viewBox stays put while the
   * pose changes. Horizontal extents ignore these: the car frames the drawing (see the
   * runaway-RC note in the extents memo).
   */
  extraPoints?: Vec2[];
  /**
   * Fill the parent box (h-full w-full, letterboxed) instead of deriving the
   * rendered height from the drawing extents — callers pin the schematic in a
   * fixed-aspect container so knob/roll changes never reflow the page.
   */
  fitBox?: boolean;
  /** For the accessible name, e.g. "front". */
  axleLabel?: string;
  /** Label camber above each wheel (Lab: tracks left/right split under roll). */
  showCamber?: boolean;
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
    const extraZs = (extraPoints ?? []).map((p) => p.z);
    /*
     * The CAR frames the drawing — the roll centre never does. RC is where the two force lines
     * cross, so as it nears ground level those lines approach parallel and the crossing point
     * runs away sideways (measured +163mm lateral on a 94mm contact patch at 3mm under the lower
     * arm, 2.5mm bump, 3° roll). Letting that into the extents shrank the car and slid it off
     * centre. The marker is ignored by BOTH axes now and pinned by `markFor` instead.
     *
     * Vertically it used to be allowed down to one car-height below ground, and that was the
     * whole bug behind "the car changes size": the floor of the frame tracked the RC, so 3mm
     * under the lower arm lifted RC from -9.1mm to above ground, the box shortened from 181.6
     * to 168.6 units, and the browser re-fitted that shorter box into the same on-screen
     * rectangle — scaling the whole car up 7.5%. Measured on the tyre, which is a fixed 64mm
     * object and therefore the honest ruler: 87.65px -> 94.24px at 390, 233.72 -> 251.32 at
     * 1760. The floor is now a FIXED window, so nothing a knob does can resize the car.
     */
    const xMin = Math.min(...contacts) - 16;
    const xMax = Math.max(...contacts) + 16;
    const zMin = -RC_WINDOW_BELOW_MM;
    // Camber labels sit above the tire tops — reserve headroom for them.
    const zMax = Math.max(tireTopZ, solved.right.innerUpper.z, ...extraZs) + (showCamber ? 12 : 5);

    const S = VIEW_W / (xMax - xMin);
    // Quantize every rendered coordinate: Node and browser libm differ by 1 ulp on
    // trig/hypot, which otherwise trips React hydration on SSR'd SVG attributes.
    const q = (n: number) => Math.round(n * 100) / 100;
    const H = q((zMax - zMin) * S);
    const X = (x: number) => q((x - xMin) * S);
    const Y = (z: number) => q((zMax - z) * S);
    const P = (p: Vec2) => `${X(p.x).toFixed(1)},${Y(p.z).toFixed(1)}`;

    /**
     * Place a roll-centre marker, pinned inside the frame. `offScale` means the true point lies
     * outside the car — the dot keeps its height but stops claiming an exact lateral position.
     */
    const markFor = (rc: Vec2) => {
      const px = X(rc.x);
      const py = Y(rc.z);
      const cx = Math.min(Math.max(px, RC_EDGE_PAD), VIEW_W - RC_EDGE_PAD);
      const cy = Math.min(Math.max(py, RC_EDGE_PAD), H - RC_EDGE_PAD);
      return { cx, cy, offScale: Math.abs(cx - px) > 0.5 || Math.abs(cy - py) > 0.5 };
    };

    const r = solved.right;
    const lowerMid = { x: (r.innerLower.x + r.lowerBall.x) / 2, z: (r.innerLower.z + r.lowerBall.z) / 2 };
    const upperMid = { x: (r.innerUpper.x + r.upperBall.x) / 2, z: (r.innerUpper.z + r.upperBall.z) / 2 };

    // Per-wheel camber anchors: the tire quad's top-edge midpoint (leans with the tire).
    const camberLabels = ([
      [solved.left, main.tires[0]],
      [solved.right, main.tires[1]],
    ] as const).map(([side, corners]) => ({
      x: (corners[2].x + corners[3].x) / 2,
      z: (corners[2].z + corners[3].z) / 2,
      deg: side.camberDeg,
    }));

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
      camberLabels,
      mainMark: markFor(main.rc),
      ghostMark: gh ? markFor(gh.rc) : null,
    };
  }, [solved, ghost, extraPoints, showCamber]);

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
      className={cn(fitBox ? "h-full w-full" : "w-full", "tabular-nums", className)}
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
              strokeOpacity={0.45}
              strokeWidth={GHOST_STROKE}
              strokeDasharray={GHOST_DASH}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          <LinkageLines solved={ghost} X={d.X} Y={d.Y} ghost />
          {d.ghostMark && (
            <circle
              cx={d.ghostMark.cx}
              cy={d.ghostMark.cy}
              r={RC_DOT_R}
              fill="none"
              stroke="currentColor"
              strokeOpacity={d.ghostMark.offScale ? 0.4 : 0.75}
              strokeWidth={1}
            />
          )}
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
        <circle key={`joint-${i}`} cx={d.X(p.x)} cy={d.Y(p.z)} r={2} fill="currentColor" fillOpacity={0.9} />
      ))}

      {/* Camber per wheel, above each tire — a rolled solve splits left/right */}
      {showCamber &&
        d.camberLabels.map((c, i) => (
          <text
            key={`camber-${i}`}
            x={d.X(c.x)}
            y={d.Y(c.z) - 5}
            textAnchor="middle"
            fontSize={9}
            fill="currentColor"
            fillOpacity={0.7}
          >
            {c.deg.toFixed(1)}°
          </text>
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

      {/* Roll center — the one yellow mark (marker only; doc's visual rule).
          A dot, matching how the Lab's migration chart already marks current RC. Hollow when
          the true point is off the car and the dot has been pinned to the frame. */}
      <g className="text-primary-ink">
        <circle
          cx={d.mainMark.cx}
          cy={d.mainMark.cy}
          r={RC_DOT_R}
          fill={d.mainMark.offScale ? "none" : "currentColor"}
          stroke={d.mainMark.offScale ? "currentColor" : "none"}
          strokeWidth={1}
        />
      </g>
      <text
        x={d.mainMark.cx}
        y={d.mainMark.cy - 6}
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
