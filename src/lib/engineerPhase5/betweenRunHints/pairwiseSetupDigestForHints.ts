import type { EngineerRunSummaryV2, EngineerSetupChangeRow } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import { describeSetupChangePerKb } from "@/lib/engineerPhase5/kbSetupKeyPhysics";

const MAX_LEN = 520;
const EPS = 1e-4;

type Direction = "raised" | "lowered" | "stiffened" | "softened" | "increased" | "decreased" | "changed";

type GroupLine = {
  line: string;
  keys: string[];
  kbTerms: string[];
  cornerMeta?: {
    family: Corner4Group["family"];
    label: string;
    end: Corner4Group["end"];
    direction: "raised" | "lowered" | "changed";
    valueText: string;
    splitChanged: boolean;
  };
};

type Corner4Group = {
  family: "upper_inner" | "under_lower";
  label: string;
  end: "front" | "rear";
  aKey: string;
  bKey: string;
  splitLabel: "FF−FR" | "RF−RR";
};

type PairGroup = {
  label: string;
  frontKey: string;
  rearKey: string;
  kind: "spring" | "generic";
  terms: string[];
};

const CORNER4_GROUPS: Corner4Group[] = [
  {
    family: "upper_inner",
    label: "Upper inner shims",
    end: "front",
    aKey: "upper_inner_shims_ff",
    bKey: "upper_inner_shims_fr",
    splitLabel: "FF−FR",
  },
  {
    family: "upper_inner",
    label: "Upper inner shims",
    end: "rear",
    aKey: "upper_inner_shims_rf",
    bKey: "upper_inner_shims_rr",
    splitLabel: "RF−RR",
  },
  {
    family: "under_lower",
    label: "Under lower arm shims",
    end: "front",
    aKey: "under_lower_arm_shims_ff",
    bKey: "under_lower_arm_shims_fr",
    splitLabel: "FF−FR",
  },
  {
    family: "under_lower",
    label: "Under lower arm shims",
    end: "rear",
    aKey: "under_lower_arm_shims_rf",
    bKey: "under_lower_arm_shims_rr",
    splitLabel: "RF−RR",
  },
];

const PAIR_GROUPS: PairGroup[] = [
  {
    label: "Spring rate",
    frontKey: "front_spring_rate_gf_mm",
    rearKey: "rear_spring_rate_gf_mm",
    kind: "spring",
    terms: ["front and rear springs", "spring rate"],
  },
  {
    label: "Spring",
    frontKey: "spring_front",
    rearKey: "spring_rear",
    kind: "spring",
    terms: ["front and rear springs"],
  },
  {
    label: "Spring gap",
    frontKey: "spring_gap_front",
    rearKey: "spring_gap_rear",
    kind: "generic",
    terms: ["front and rear spring gap"],
  },
  {
    label: "Damper oil",
    frontKey: "damper_oil_front",
    rearKey: "damper_oil_rear",
    kind: "generic",
    terms: ["front and rear damper oil"],
  },
  {
    label: "Damper %",
    frontKey: "damper_percent_front",
    rearKey: "damper_percent_rear",
    kind: "generic",
    terms: ["front and rear damper percent"],
  },
  {
    label: "Damping",
    frontKey: "damping_front",
    rearKey: "damping_rear",
    kind: "generic",
    terms: ["front and rear damping"],
  },
  {
    label: "PSS % setup",
    frontKey: "pss_percent_setup_front",
    rearKey: "pss_percent_setup_rear",
    kind: "generic",
    terms: ["front and rear PSS"],
  },
  {
    label: "Ride height",
    frontKey: "ride_height_front",
    rearKey: "ride_height_rear",
    kind: "generic",
    terms: ["front and rear ride height"],
  },
  {
    label: "Downstop",
    frontKey: "downstop_front",
    rearKey: "downstop_rear",
    kind: "generic",
    terms: ["front and rear downstop"],
  },
  {
    label: "Droop",
    frontKey: "droop_front",
    rearKey: "droop_rear",
    kind: "generic",
    terms: ["front and rear droop"],
  },
  {
    label: "Upstop",
    frontKey: "upstop_front",
    rearKey: "upstop_rear",
    kind: "generic",
    terms: ["front and rear upstop"],
  },
  {
    label: "ARB",
    frontKey: "arb_front",
    rearKey: "arb_rear",
    kind: "generic",
    terms: ["front and rear ARB"],
  },
  {
    label: "Diff height",
    frontKey: "diff_height_front",
    rearKey: "diff_height_rear",
    kind: "generic",
    terms: ["front and rear diff height"],
  },
  {
    label: "Upper outer shims",
    frontKey: "upper_outer_shims_front",
    rearKey: "upper_outer_shims_rear",
    kind: "generic",
    terms: ["front and rear upper outer shims", "upper link"],
  },
  {
    label: "Under hub shims",
    frontKey: "under_hub_shims_front",
    rearKey: "under_hub_shims_rear",
    kind: "generic",
    terms: ["front and rear under hub shims"],
  },
];

function parseNumber(raw: string): number | null {
  const t = raw.trim();
  if (!t || t === "—" || t === "-") return null;
  const cleaned = t
    .replace(/mm|gf\/mm|cst|wt|%|°/gi, "")
    .replace(",", ".")
    .trim();
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function delta(row: EngineerSetupChangeRow): number | null {
  const before = parseNumber(row.before);
  const after = parseNumber(row.after);
  if (before == null || after == null) return null;
  return after - before;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function changedSameDirection(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return false;
  if (Math.abs(a) < EPS || Math.abs(b) < EPS) return false;
  return Math.sign(a) === Math.sign(b);
}

function directionForPair(kind: PairGroup["kind"], d: number | null): Direction {
  if (d == null || Math.abs(d) < EPS) return "changed";
  if (kind === "spring") return d > 0 ? "stiffened" : "softened";
  return d > 0 ? "increased" : "decreased";
}

function directionForShims(d: number | null): "raised" | "lowered" | "changed" {
  if (d == null || Math.abs(d) < EPS) return "changed";
  return d > 0 ? "raised" : "lowered";
}

function rowText(row: EngineerSetupChangeRow): string {
  const kb = describeSetupChangePerKb(row.key, row.before, row.after);
  if (kb) return kb;
  return `${row.label}: ${row.before} → ${row.after}`;
}

function buildCorner4GroupLine(group: Corner4Group, a: EngineerSetupChangeRow, b: EngineerSetupChangeRow): GroupLine | null {
  const da = delta(a);
  const db = delta(b);
  const beforeA = parseNumber(a.before);
  const beforeB = parseNumber(b.before);
  const afterA = parseNumber(a.after);
  const afterB = parseNumber(b.after);
  const sameValues = a.before === b.before && a.after === b.after;
  const sameDirection = changedSameDirection(da, db);
  if (!sameValues && !sameDirection) return null;

  const avgBefore = beforeA != null && beforeB != null ? (beforeA + beforeB) / 2 : null;
  const avgAfter = afterA != null && afterB != null ? (afterA + afterB) / 2 : null;
  const avgDelta = avgBefore != null && avgAfter != null ? avgAfter - avgBefore : da != null && db != null ? (da + db) / 2 : null;
  const direction = directionForShims(avgDelta);
  const valueText = sameValues
    ? `${a.before} → ${a.after}`
    : avgBefore != null && avgAfter != null
      ? `average ${fmt(avgBefore)} → ${fmt(avgAfter)}`
      : `${a.before}/${b.before} → ${a.after}/${b.after}`;

  const keys = [a.key, b.key];
  const kbTerms =
    group.family === "under_lower"
      ? ["under lower arm", `${group.end} lower arm ${direction}`, group.end === "front" ? "anti-dive" : "anti-squat"]
      : ["upper inner shims", `${group.end} upper inner ${direction}`, "upper link angle", "roll centre"];

  const base =
    group.family === "under_lower"
      ? `${group.label}: ${group.end} axle ${direction} (${valueText}); this moves inner lower-arm height / roll centre on that axle`
      : `${group.label}: ${group.end} axle ${direction} (${valueText}); this moves upper inner pickup height / roll centre on that axle`;

  const splitBefore = beforeA != null && beforeB != null ? beforeA - beforeB : null;
  const splitAfter = afterA != null && afterB != null ? afterA - afterB : null;
  const splitChanged =
    splitBefore != null && splitAfter != null && Math.abs(splitAfter - splitBefore) >= 0.02 && Math.abs((da ?? 0) - (db ?? 0)) >= 0.02;

  if (!splitChanged) {
    return {
      line: base,
      keys,
      kbTerms,
      cornerMeta: {
        family: group.family,
        label: group.label,
        end: group.end,
        direction,
        valueText,
        splitChanged: false,
      },
    };
  }

  const splitText = `${group.splitLabel} ${fmt(splitBefore!)} → ${fmt(splitAfter!)}`;
  if (group.family === "under_lower") {
    const anti = group.end === "front" ? "anti-dive" : "anti-squat";
    return {
      line: `${base}; pickup split changed (${splitText}), so ${anti} geometry also changed`,
      keys,
      kbTerms,
      cornerMeta: {
        family: group.family,
        label: group.label,
        end: group.end,
        direction,
        valueText,
        splitChanged: true,
      },
    };
  }

  return {
    line: `${base}; upper-inner pickup split changed (${splitText}), so upper-link angle along the car also changed`,
    keys,
    kbTerms,
    cornerMeta: {
      family: group.family,
      label: group.label,
      end: group.end,
      direction,
      valueText,
      splitChanged: true,
    },
  };
}

function buildPairGroupLine(group: PairGroup, front: EngineerSetupChangeRow, rear: EngineerSetupChangeRow): GroupLine | null {
  const df = delta(front);
  const dr = delta(rear);
  if (!changedSameDirection(df, dr)) return null;

  const direction = directionForPair(group.kind, (df! + dr!) / 2);
  const sameValues = front.before === rear.before && front.after === rear.after;
  const valueText = sameValues ? `${front.before} → ${front.after}` : `front ${front.before} → ${front.after}, rear ${rear.before} → ${rear.after}`;
  return {
    line: `${group.label}: front and rear ${direction} (${valueText})`,
    keys: [front.key, rear.key],
    kbTerms: group.terms,
  };
}

function combineFrontRearCornerGroups(groups: GroupLine[]): GroupLine[] {
  const used = new Set<number>();
  const out: GroupLine[] = [];

  for (let i = 0; i < groups.length; i += 1) {
    if (used.has(i)) continue;
    const current = groups[i];
    const meta = current.cornerMeta;
    if (!meta || meta.splitChanged || meta.end !== "front") {
      out.push(current);
      continue;
    }

    const rearIndex = groups.findIndex((candidate, idx) => {
      const other = candidate.cornerMeta;
      return (
        idx > i &&
        !used.has(idx) &&
        other != null &&
        !other.splitChanged &&
        other.end === "rear" &&
        other.family === meta.family &&
        other.direction === meta.direction
      );
    });
    if (rearIndex === -1) {
      out.push(current);
      continue;
    }

    const rear = groups[rearIndex];
    const rearMeta = rear.cornerMeta!;
    used.add(i);
    used.add(rearIndex);
    const valueText =
      meta.valueText === rearMeta.valueText
        ? meta.valueText
        : `front ${meta.valueText}, rear ${rearMeta.valueText}`;
    const effect =
      meta.family === "under_lower"
        ? "this moves inner lower-arm height / roll centre at both ends"
        : "this moves upper inner pickup height / roll centre at both ends";
    out.push({
      line: `${meta.label}: front and rear axles ${meta.direction} (${valueText}); ${effect}`,
      keys: [...current.keys, ...rear.keys],
      kbTerms: Array.from(new Set([...current.kbTerms, ...rear.kbTerms])),
    });
  }

  return out;
}

export function buildGroupedPairwiseSetupChangeLines(summary: EngineerRunSummaryV2): {
  lines: string[];
  kbTerms: string[];
} {
  const rows = summary.setupChanges;
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const used = new Set<string>();
  const cornerGroups: GroupLine[] = [];
  const pairGroups: GroupLine[] = [];

  for (const group of CORNER4_GROUPS) {
    const a = byKey.get(group.aKey);
    const b = byKey.get(group.bKey);
    if (!a || !b || used.has(a.key) || used.has(b.key)) continue;
    const line = buildCorner4GroupLine(group, a, b);
    if (!line) continue;
    cornerGroups.push(line);
    line.keys.forEach((key) => used.add(key));
  }

  for (const group of PAIR_GROUPS) {
    const front = byKey.get(group.frontKey);
    const rear = byKey.get(group.rearKey);
    if (!front || !rear || used.has(front.key) || used.has(rear.key)) continue;
    const line = buildPairGroupLine(group, front, rear);
    if (!line) continue;
    pairGroups.push(line);
    line.keys.forEach((key) => used.add(key));
  }

  const groups = [...combineFrontRearCornerGroups(cornerGroups), ...pairGroups];
  const lines = [...groups.map((g) => g.line), ...rows.filter((r) => !used.has(r.key)).map(rowText)];
  const kbTerms = Array.from(new Set(groups.flatMap((g) => g.kbTerms)));
  return { lines, kbTerms };
}

/**
 * Single canonical line of documented pairwise tuning moves for between-run hint LLM context.
 */
export function buildPairwiseSetupDigestForHints(summary: EngineerRunSummaryV2): string | null {
  if (!summary.setupChanges.length) return null;
  const grouped = buildGroupedPairwiseSetupChangeLines(summary);
  const s = `Documented pairwise tuning changes (${summary.setupChanges.length} rows, grouped where related): ${grouped.lines.join("; ")}`;
  return s.length > MAX_LEN ? `${s.slice(0, MAX_LEN - 1)}…` : s;
}
