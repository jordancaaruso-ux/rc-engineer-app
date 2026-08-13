/**
 * Setup snapshot → computed geometry. The mapping layer of the roll center feature:
 * reads the sheet's shim stacks, build choices, ride height and camber, layers them
 * on the platform pack, and returns RC / rake / camber gain / true arm angles.
 *
 * Missing-data doctrine (docs/ROLL_CENTER_NORTH_STAR.md): compute with defaults and
 * FLAG assumptions — never block, never silently guess. Deltas between two snapshots
 * with the same gaps stay valid.
 */
import {
  computeAxleMetrics,
  solveAxle,
  solveCamberTrim,
  ZERO_ADJUSTMENTS,
  type AxleAdjustments,
  type AxleGeometry,
  type AxleMetrics,
  type SolvedAxle,
} from "./engine";
import {
  chassisMountShiftMm,
  resolvePackForSnapshot,
  type RollCenterPack,
} from "./packs";

export type RollCenterComputation = {
  packId: string;
  packDisplayName: string;
  verificationGrade: RollCenterPack["verificationGrade"];
  front: AxleMetrics;
  rear: AxleMetrics;
  /** rear RC − front RC; + = rakes down toward the front. */
  rakeMm: number;
  /** Human-readable list of everything that was defaulted, for the "assumed: …" note. */
  assumptions: string[];
};

/** Tolerant numeric parse for sheet values ("0.5", "0.5mm", "1,0", 0.5, booleans). */
function parseMm(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === "—" || s === "-") return null;
  const cleaned = s.replace(/mm|°|deg/gi, "").replace(",", ".").trim();
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Flatten any snapshot value (string / preset object / array) to searchable text. */
function valueText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(valueText).join(" ");
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return "";
    }
  }
  return String(v);
}

/** Mean of the two arm legs; single-leg fallback with an assumption note. */
function legMean(
  a: number | null,
  b: number | null,
  label: string,
  assumptions: string[]
): number {
  if (a != null && b != null) return (a + b) / 2;
  if (a != null || b != null) {
    assumptions.push(`${label}: one leg missing, used the other`);
    return (a ?? b) as number;
  }
  assumptions.push(`${label}: no shims recorded, assumed 0`);
  return 0;
}

function detectChassisCode(pack: RollCenterPack, raw: unknown): string | null {
  const text = valueText(raw).toUpperCase();
  if (!text) return null;
  // Longest-code-first so "RAF" can't be shadowed by shorter codes.
  const codes = Object.keys(pack.chassisOptions).sort((a, b) => b.length - a.length);
  for (const code of codes) {
    if (text.includes(code.toUpperCase())) return code;
  }
  // Material words as a fallback for free-text values.
  if (/CARBON/.test(text)) return "C01B-RC";
  if (/ALU/.test(text)) return "C01B-RAF";
  if (/STEEL/.test(text)) return "C01RS";
  return null;
}

type AxleKeys = {
  underLowerLegA: string;
  underLowerLegB: string;
  upperInnerLegA: string;
  upperInnerLegB: string;
  underHub: string;
  upperOuter: string;
  rideHeight: string;
  camber: string;
  wheelSpacer: string;
  label: "front" | "rear";
};

const FRONT_KEYS: AxleKeys = {
  underLowerLegA: "under_lower_arm_shims_ff",
  underLowerLegB: "under_lower_arm_shims_fr",
  upperInnerLegA: "upper_inner_shims_ff",
  upperInnerLegB: "upper_inner_shims_fr",
  underHub: "under_hub_shims_front",
  upperOuter: "upper_outer_shims_front",
  rideHeight: "ride_height_front",
  camber: "camber_front",
  wheelSpacer: "wheel_spacer_front",
  label: "front",
};

const REAR_KEYS: AxleKeys = {
  underLowerLegA: "under_lower_arm_shims_rf",
  underLowerLegB: "under_lower_arm_shims_rr",
  upperInnerLegA: "upper_inner_shims_rf",
  upperInnerLegB: "upper_inner_shims_rr",
  underHub: "under_hub_shims_rear",
  upperOuter: "upper_outer_shims_rear",
  rideHeight: "ride_height_rear",
  camber: "camber_rear",
  wheelSpacer: "wheel_spacer_rear",
  label: "rear",
};

function axleAdjustments(
  data: Record<string, unknown>,
  geo: AxleGeometry,
  keys: AxleKeys,
  mountZShiftMm: number,
  assumptions: string[]
): AxleAdjustments {
  const adj: AxleAdjustments = { ...ZERO_ADJUSTMENTS, mountZShiftMm };

  adj.underLowerArmMm = legMean(
    parseMm(data[keys.underLowerLegA]),
    parseMm(data[keys.underLowerLegB]),
    `${keys.label} under-lower-arm shims`,
    assumptions
  );
  adj.upperInnerMm = legMean(
    parseMm(data[keys.upperInnerLegA]),
    parseMm(data[keys.upperInnerLegB]),
    `${keys.label} upper-inner shims`,
    assumptions
  );

  const underHub = parseMm(data[keys.underHub]);
  if (underHub == null) assumptions.push(`${keys.label} under-hub shims assumed 0`);
  adj.underHubMm = underHub ?? 0;

  const upperOuter = parseMm(data[keys.upperOuter]);
  if (upperOuter == null) assumptions.push(`${keys.label} upper-outer shims assumed 0`);
  adj.upperOuterMm = upperOuter ?? 0;

  const rideHeight = parseMm(data[keys.rideHeight]);
  if (rideHeight == null) {
    assumptions.push(`${keys.label} ride height assumed ${geo.frameBottom.toFixed(1)}mm`);
  } else if (Math.abs(rideHeight - geo.frameBottom) > 3) {
    assumptions.push(
      `${keys.label} ride height ${rideHeight}mm looks implausible, used ${geo.frameBottom.toFixed(1)}mm`
    );
  } else {
    adj.rideDeltaMm = rideHeight - geo.frameBottom;
  }

  const spacer = parseMm(data[keys.wheelSpacer]);
  if (spacer != null && Math.abs(spacer) <= 4) adj.wheelSpacerMm = spacer;

  // Camber: sheets record magnitude of negative camber ("2.0" = −2.0°).
  const camberRaw = parseMm(data[keys.camber]);
  if (camberRaw == null) {
    assumptions.push(`${keys.label} camber not recorded, used link-length default`);
  } else {
    const target = -Math.abs(camberRaw);
    const trim = solveCamberTrim(geo, adj, target);
    if (trim != null) adj.camberTrimMm = trim;
    else assumptions.push(`${keys.label} camber ${camberRaw} couldn't be matched, used default`);
  }

  return adj;
}

export type SnapshotGeometryInputs = {
  pack: RollCenterPack;
  frontAdj: AxleAdjustments;
  rearAdj: AxleAdjustments;
  assumptions: string[];
};

/**
 * Shared derivation: pack + per-axle adjustments + assumption notes from a snapshot.
 * Exported for the Geometry Lab, which needs the raw adjustments to run rolled
 * solves and sensitivity sweeps beyond the static metrics.
 */
export function deriveRollCenterInputs(
  data: Record<string, unknown>
): SnapshotGeometryInputs | null {
  return deriveSnapshotInputs(data);
}

function deriveSnapshotInputs(
  data: Record<string, unknown>,
  packOverride?: RollCenterPack | null
): SnapshotGeometryInputs | null {
  // An explicit pack means the caller knows the car (see `resolvePackForTemplateKey`); the sniffed
  // fallback exists only for the Lab, which has no car context.
  const pack = packOverride ?? resolvePackForSnapshot(data);
  if (!pack) return null;

  const assumptions: string[] = [];

  const chassisCode = detectChassisCode(pack, data["chassis"]);
  const mountShift = chassisCode != null ? chassisMountShiftMm(pack, chassisCode) : null;
  if (mountShift == null) {
    assumptions.push(`chassis assumed ${pack.chassisOptions[pack.baseChassisCode].label.toLowerCase()}`);
  }
  const mountZShiftMm = mountShift ?? 0;

  // Tire: no canonical tire-diameter key exists yet — nominal OD is always assumed.
  assumptions.push(`tire Ø ${AWESOMATIX_NOMINAL_TIRE_NOTE}`);

  const frontAdj = axleAdjustments(data, pack.front, FRONT_KEYS, mountZShiftMm, assumptions);
  const rearAdj = axleAdjustments(data, pack.rear, REAR_KEYS, mountZShiftMm, assumptions);

  return { pack, frontAdj, rearAdj, assumptions };
}

/**
 * Compute geometry for a setup snapshot. Null when no pack applies or the linkage can't assemble.
 *
 * Pass `pack` wherever the car is known — `resolvePackForTemplateKey(templateKey)`. Omitting it
 * falls back to sniffing field names, which is only correct in the Lab.
 */
export function computeRollCenterFromSnapshot(
  data: Record<string, unknown>,
  packForCar?: RollCenterPack | null
): RollCenterComputation | null {
  const inputs = deriveSnapshotInputs(data, packForCar);
  if (!inputs) return null;
  const { pack, frontAdj, rearAdj, assumptions } = inputs;

  const front = computeAxleMetrics(pack.front, frontAdj);
  const rear = computeAxleMetrics(pack.rear, rearAdj);
  if (!front || !rear) return null;

  return {
    packId: pack.id,
    packDisplayName: pack.displayName,
    verificationGrade: pack.verificationGrade,
    front,
    rear,
    rakeMm: rear.rcHeightMm - front.rcHeightMm,
    assumptions,
  };
}

/**
 * Full solved linkage poses (static, 0° roll) for drawing the front-view schematic —
 * the expanded sheet block and the future Lab. Null when no pack matches or a side
 * can't assemble; callers hide the diagram and let the numeric block stand alone.
 */
export type RollCenterDiagramSolves = {
  front: SolvedAxle;
  rear: SolvedAxle;
};

export function solveRollCenterDiagram(
  data: Record<string, unknown>,
  packForCar?: RollCenterPack | null
): RollCenterDiagramSolves | null {
  const inputs = deriveSnapshotInputs(data, packForCar);
  if (!inputs) return null;
  const front = solveAxle(inputs.pack.front, inputs.frontAdj, 0);
  const rear = solveAxle(inputs.pack.rear, inputs.rearAdj, 0);
  if (!front?.rollCentre || !rear?.rollCentre) return null;
  return { front, rear };
}

const AWESOMATIX_NOMINAL_TIRE_NOTE = "64mm nominal";
