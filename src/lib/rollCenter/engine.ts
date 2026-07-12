/**
 * 2D front-elevation double-wishbone kinematics — the geometric roll center engine.
 *
 * Coordinates: x lateral from car centerline (right = +), z up from ground, mm.
 * VSUSP-compatible hardpoint parameterization (see docs/ROLL_CENTER_NORTH_STAR.md):
 * frame mounts from centerline + chassis bottom, ball-to-ball arm lengths, rigid
 * knuckle (hub → ball offsets), wheel plane at hub + wheel offset, loaded tire radius.
 *
 * Validated against VSUSP on the founder's measured Awesomatix A800R:
 * front RC −9.09 vs −9.1, rear −8.50 vs −8.5 (see rollCenter.test.ts).
 *
 * Each side is a 1-DOF four-bar: bisection on the lower-arm angle until the tire
 * contact point sits on the ground. Trust doctrine: deltas between two solves are
 * instrument-grade; absolute values inherit the pack's verification grade.
 */

export type Vec2 = { x: number; z: number };

/** Base hardpoints for one axle — the platform pack's per-axle payload. All mm. */
export type AxleGeometry = {
  /** Chassis bottom above ground at the ride height the pack was measured at. */
  frameBottom: number;
  upperInnerX: number;
  /** Upper link inner mount above the chassis bottom. */
  upperInnerZrel: number;
  lowerInnerX: number;
  lowerInnerZrel: number;
  /** Ball-to-ball link lengths. */
  upperLen: number;
  lowerLen: number;
  /** Knuckle rigid body: ball offsets from the hub (wheel centre), balls inboard. */
  hubToUpperX: number;
  hubToUpperY: number;
  hubToLowerX: number;
  hubToLowerY: number;
  /** Wheel plane inboard of the hub. */
  wheelOffset: number;
  tireDia: number;
  /** Static tire squash in mm (loaded radius = tireDia/2 − tireCompMm). */
  tireCompMm: number;
};

/** Per-setup adjustments layered on the base geometry. All mm, 0 = pack baseline. */
export type AxleAdjustments = {
  /** Shims under the lower arm inner mounts (mean of the two legs). Raises the lower inner pivot. */
  underLowerArmMm: number;
  /** Shims under the upper link inner mounts (mean of the two legs). Raises the upper inner pivot. */
  upperInnerMm: number;
  /** Shims under the hub: raise the hub off the lower ball → lower ball moves DOWN in the knuckle frame. */
  underHubMm: number;
  /** Shims under the outer upper ballstud: upper ball up in the knuckle frame. */
  upperOuterMm: number;
  /** Camber link length change (turnbuckle), + = longer. */
  camberTrimMm: number;
  /** Chassis heave vs the pack's nominal ride height (+ = higher). */
  rideDeltaMm: number;
  /** Datum shift of both frame mounts (e.g. thicker chassis plate raises everything bolted to it). */
  mountZShiftMm: number;
  /** Wheel spacer: moves the wheel plane outboard (reduces the inboard wheel offset). */
  wheelSpacerMm: number;
};

export const ZERO_ADJUSTMENTS: AxleAdjustments = {
  underLowerArmMm: 0,
  upperInnerMm: 0,
  underHubMm: 0,
  upperOuterMm: 0,
  camberTrimMm: 0,
  rideDeltaMm: 0,
  mountZShiftMm: 0,
  wheelSpacerMm: 0,
};

export type SolvedSide = {
  innerLower: Vec2;
  innerUpper: Vec2;
  lowerBall: Vec2;
  upperBall: Vec2;
  hub: Vec2;
  wheelPlaneCentre: Vec2;
  contact: Vec2;
  /** Instant centre (null when the arm lines are parallel — IC at infinity). */
  instantCentre: Vec2 | null;
  /** Signed wheel-plane lean: negative = top leaning toward the car. */
  camberDeg: number;
};

export type SolvedAxle = {
  left: SolvedSide;
  right: SolvedSide;
  /** Geometric roll centre (null only if the two force lines are parallel). */
  rollCentre: Vec2 | null;
};

export type AxleMetrics = {
  rcHeightMm: number;
  rcLateralMm: number;
  camberDeg: number;
  /** Camber change per mm of bump (chassis down); typically negative. */
  camberGainDegPerMm: number | null;
  /** True arm inclinations, + = outer end higher than inner. */
  lowerArmAngleDeg: number;
  upperLinkAngleDeg: number;
  /** Contact patch to contact patch. */
  trackMm: number;
};

const ROLL_CENTRE_OF_ROTATION: Vec2 = { x: 0, z: 25 };

type Line = { a: number; b: number; c: number };

const lineThrough = (p: Vec2, q: Vec2): Line => ({
  a: p.z - q.z,
  b: q.x - p.x,
  c: p.x * q.z - q.x * p.z,
});

function lineIntersection(l1: Line, l2: Line): Vec2 | null {
  const w = l1.a * l2.b - l2.a * l1.b;
  if (Math.abs(w) < 1e-9) return null;
  return { x: (l1.b * l2.c - l2.b * l1.c) / w, z: (l2.a * l1.c - l1.a * l2.c) / w };
}

/** Both circle-circle intersection points, or null when the circles don't meet. */
function circleIntersections(
  c1: Vec2,
  r1: number,
  c2: Vec2,
  r2: number
): [Vec2, Vec2] | null {
  const dx = c2.x - c1.x;
  const dz = c2.z - c1.z;
  const d = Math.hypot(dx, dz);
  if (d === 0 || d > r1 + r2 || d < Math.abs(r1 - r2)) return null;
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  if (h2 < 0) return null;
  const h = Math.sqrt(h2);
  const mx = c1.x + (dx * a) / d;
  const mz = c1.z + (dz * a) / d;
  const ux = dx / d;
  const uz = dz / d;
  return [
    { x: mx - h * uz, z: mz + h * ux },
    { x: mx + h * uz, z: mz - h * ux },
  ];
}

function chassisTransform(rideDeltaMm: number, rollDeg: number) {
  const phi = (rollDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const c = ROLL_CENTRE_OF_ROTATION;
  return (p: Vec2): Vec2 => ({
    x: c.x + (p.x - c.x) * cos - (p.z - c.z) * sin,
    z: c.z + (p.x - c.x) * sin + (p.z - c.z) * cos + rideDeltaMm,
  });
}

function loadedRadius(geo: AxleGeometry): number {
  return geo.tireDia / 2 - geo.tireCompMm;
}

/** Pose the linkage for a given lower-arm angle. Null when it can't assemble. */
function pose(
  geo: AxleGeometry,
  adj: AxleAdjustments,
  side: 1 | -1,
  toWorld: (p: Vec2) => Vec2,
  theta: number
): SolvedSide | null {
  const s = side;
  const innerLower = toWorld({
    x: s * geo.lowerInnerX,
    z: geo.frameBottom + geo.lowerInnerZrel + adj.mountZShiftMm + adj.underLowerArmMm,
  });
  const innerUpper = toWorld({
    x: s * geo.upperInnerX,
    z: geo.frameBottom + geo.upperInnerZrel + adj.mountZShiftMm + adj.upperInnerMm,
  });
  const lowerBall: Vec2 = {
    x: innerLower.x + s * geo.lowerLen * Math.cos(theta),
    z: innerLower.z + geo.lowerLen * Math.sin(theta),
  };

  // Knuckle local frame: origin at hub, +x outboard, +z up. Under-hub shims move
  // the lower ball DOWN in this frame; outer ballstud shims move the upper ball up.
  const localLower: Vec2 = { x: -geo.hubToLowerX, z: -geo.hubToLowerY - adj.underHubMm };
  const localUpper: Vec2 = { x: -geo.hubToUpperX, z: geo.hubToUpperY + adj.upperOuterMm };
  const dLU: Vec2 = { x: s * (localUpper.x - localLower.x), z: localUpper.z - localLower.z };
  const ballSpacing = Math.hypot(dLU.x, dLU.z);

  const candidates = circleIntersections(
    innerUpper,
    geo.upperLen + adj.camberTrimMm,
    lowerBall,
    ballSpacing
  );
  if (!candidates) return null;

  // Pick the branch keeping the knuckle nearest upright (smallest rotation).
  const baseAngle = Math.atan2(dLU.z, dLU.x);
  let upperBall: Vec2 | null = null;
  let phi = 0;
  let bestRotation = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const angle = Math.atan2(candidate.z - lowerBall.z, candidate.x - lowerBall.x);
    let rotation = angle - baseAngle;
    while (rotation > Math.PI) rotation -= 2 * Math.PI;
    while (rotation < -Math.PI) rotation += 2 * Math.PI;
    if (Math.abs(rotation) < bestRotation) {
      bestRotation = Math.abs(rotation);
      upperBall = candidate;
      phi = rotation;
    }
  }
  if (!upperBall || bestRotation > 0.8) return null; // knuckle rolled >45° = wrong branch

  const rot = (p: Vec2): Vec2 => ({
    x: p.x * Math.cos(phi) - p.z * Math.sin(phi),
    z: p.x * Math.sin(phi) + p.z * Math.cos(phi),
  });
  const hubFromLower = rot({ x: s * -localLower.x, z: -localLower.z });
  const hub: Vec2 = { x: lowerBall.x + hubFromLower.x, z: lowerBall.z + hubFromLower.z };

  const rLoaded = loadedRadius(geo);
  const up = rot({ x: 0, z: 1 });
  const planeOffset = rot({ x: s * -(geo.wheelOffset - adj.wheelSpacerMm), z: 0 });
  const wheelPlaneCentre: Vec2 = { x: hub.x + planeOffset.x, z: hub.z + planeOffset.z };
  const contact: Vec2 = {
    x: wheelPlaneCentre.x - up.x * rLoaded,
    z: wheelPlaneCentre.z - up.z * rLoaded,
  };
  const camberDeg = (Math.atan2(s * up.x, up.z) * 180) / Math.PI;

  return {
    innerLower,
    innerUpper,
    lowerBall,
    upperBall,
    hub,
    wheelPlaneCentre,
    contact,
    instantCentre: null, // filled by solveAxle
    camberDeg,
  };
}

function solveSide(
  geo: AxleGeometry,
  adj: AxleAdjustments,
  side: 1 | -1,
  toWorld: (p: Vec2) => Vec2
): SolvedSide | null {
  const N = 90;
  const lo = -0.65;
  const hi = 0.65;
  let prevTheta: number | null = null;
  let prevF = 0;
  for (let i = 0; i <= N; i++) {
    const theta = lo + ((hi - lo) * i) / N;
    const g = pose(geo, adj, side, toWorld, theta);
    if (!g) {
      prevTheta = null;
      continue;
    }
    const f = g.contact.z;
    if (prevTheta !== null && prevF <= 0 && f >= 0) {
      let a = prevTheta;
      let b = theta;
      let fa = prevF;
      for (let k = 0; k < 48; k++) {
        const mid = (a + b) / 2;
        const gm = pose(geo, adj, side, toWorld, mid);
        if (!gm) break;
        if (fa <= 0 === gm.contact.z <= 0) {
          a = mid;
          fa = gm.contact.z;
        } else {
          b = mid;
        }
      }
      return pose(geo, adj, side, toWorld, (a + b) / 2);
    }
    prevTheta = theta;
    prevF = f;
  }
  return null;
}

/** Solve both sides + the roll centre at a given chassis roll angle (0 = static). */
export function solveAxle(
  geo: AxleGeometry,
  adj: AxleAdjustments,
  rollDeg = 0
): SolvedAxle | null {
  const toWorld = chassisTransform(adj.rideDeltaMm, rollDeg);
  const right = solveSide(geo, adj, 1, toWorld);
  const left = solveSide(geo, adj, -1, toWorld);
  if (!right || !left) return null;

  for (const s of [right, left]) {
    s.instantCentre = lineIntersection(
      lineThrough(s.innerLower, s.lowerBall),
      lineThrough(s.innerUpper, s.upperBall)
    );
  }
  const forceLine = (s: SolvedSide): Line =>
    s.instantCentre
      ? lineThrough(s.contact, s.instantCentre)
      : lineThrough(s.contact, {
          x: s.contact.x + (s.lowerBall.x - s.innerLower.x),
          z: s.contact.z + (s.lowerBall.z - s.innerLower.z),
        });
  const rollCentre = lineIntersection(forceLine(right), forceLine(left));
  return { left, right, rollCentre };
}

const armAngleDeg = (inner: Vec2, outer: Vec2): number =>
  (Math.atan2(outer.z - inner.z, outer.x - inner.x) * 180) / Math.PI;

/** Static metrics for one axle: RC, camber, camber gain, true arm angles, track. */
export function computeAxleMetrics(
  geo: AxleGeometry,
  adj: AxleAdjustments
): AxleMetrics | null {
  const solved = solveAxle(geo, adj, 0);
  if (!solved || !solved.rollCentre) return null;
  const bumped = solveAxle(geo, { ...adj, rideDeltaMm: adj.rideDeltaMm - 1 }, 0);
  const r = solved.right;
  return {
    rcHeightMm: solved.rollCentre.z,
    rcLateralMm: solved.rollCentre.x,
    camberDeg: r.camberDeg,
    camberGainDegPerMm: bumped ? bumped.right.camberDeg - r.camberDeg : null,
    lowerArmAngleDeg: armAngleDeg(r.innerLower, r.lowerBall),
    upperLinkAngleDeg: armAngleDeg(r.innerUpper, r.upperBall),
    trackMm: r.contact.x - solved.left.contact.x,
  };
}

/**
 * Back-solve the camber link trim that hits a target static camber (secant method).
 * Sensitivity is ~2.7°/mm on a TC, near-linear over the trim range.
 */
export function solveCamberTrim(
  geo: AxleGeometry,
  adj: AxleAdjustments,
  targetCamberDeg: number
): number | null {
  let t0 = 0;
  const m0 = computeAxleMetrics(geo, { ...adj, camberTrimMm: t0 });
  if (!m0) return null;
  let c0 = m0.camberDeg;
  let t1 = t0 + (targetCamberDeg - c0) / 2.7;
  for (let i = 0; i < 6; i++) {
    if (Math.abs(t1) > 3) return null; // implausible — bad input, refuse rather than distort
    const m1 = computeAxleMetrics(geo, { ...adj, camberTrimMm: t1 });
    if (!m1) return null;
    const c1 = m1.camberDeg;
    if (Math.abs(c1 - targetCamberDeg) < 0.005) return t1;
    if (Math.abs(c1 - c0) < 1e-9) break;
    const t2 = t1 + ((targetCamberDeg - c1) * (t1 - t0)) / (c1 - c0);
    t0 = t1;
    c0 = c1;
    t1 = t2;
  }
  return t1;
}
