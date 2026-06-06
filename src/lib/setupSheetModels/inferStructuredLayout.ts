import type {
  SetupSheetModelFieldDef,
  SetupSheetModelLayoutRow,
  SetupSheetModelSchema,
} from "@/lib/setupSheetModels/types";

type CornerSuffix = "ff" | "fr" | "rf" | "rr";
type PairSide = "front" | "rear";

const CORNER_SUFFIX_RE = /_(ff|fr|rf|rr)$/;
const PAIR_SUFFIX_RE = /_(front|rear)$/;

function parseCornerKey(key: string): { prefix: string; corner: CornerSuffix } | null {
  const m = key.match(CORNER_SUFFIX_RE);
  if (!m) return null;
  return { prefix: key.slice(0, -m[0].length), corner: m[1] as CornerSuffix };
}

function parsePairKey(key: string): { prefix: string; side: PairSide } | null {
  const m = key.match(PAIR_SUFFIX_RE);
  if (!m) return null;
  return { prefix: key.slice(0, -m[0].length), side: m[1] as PairSide };
}

function stripSideFromLabel(label: string): string {
  return label
    .replace(/\s*[\(·]?\s*(FF|FR|RF|RR|Front|Rear)\s*\)?\s*$/i, "")
    .trim();
}

function humanizeKey(prefix: string): string {
  return prefix
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function inferGroupLabel(fields: SetupSheetModelFieldDef[], prefix: string): string {
  const stripped = fields.map((f) => stripSideFromLabel(f.displayLabel)).filter(Boolean);
  if (stripped.length === 0) return humanizeKey(prefix);

  let common = stripped[0]!;
  for (const s of stripped.slice(1)) {
    while (common && !s.toLowerCase().startsWith(common.toLowerCase())) {
      common = common.slice(0, -1).trimEnd();
    }
  }
  if (common.length >= 2) return common;
  return humanizeKey(prefix);
}

function pickSharedUnit(fields: SetupSheetModelFieldDef[]): string | undefined {
  const units = [...new Set(fields.map((f) => f.unit?.trim()).filter(Boolean))];
  return units.length === 1 ? units[0] : undefined;
}

function isSpecialLayoutRow(row: SetupSheetModelLayoutRow): boolean {
  return row.type === "screw_strip" || row.type === "top_deck_block";
}

/** Infer rows for one section from its field defs (corner4, pair, single). */
export function inferSectionLayoutRows(fields: SetupSheetModelFieldDef[]): SetupSheetModelLayoutRow[] {
  const sorted = [...fields].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  const consumed = new Set<string>();
  const rows: SetupSheetModelLayoutRow[] = [];

  const cornerGroups = new Map<string, Map<CornerSuffix, SetupSheetModelFieldDef>>();
  const pairGroups = new Map<string, Map<PairSide, SetupSheetModelFieldDef>>();

  for (const f of sorted) {
    const corner = parseCornerKey(f.key);
    if (corner) {
      let g = cornerGroups.get(corner.prefix);
      if (!g) {
        g = new Map();
        cornerGroups.set(corner.prefix, g);
      }
      g.set(corner.corner, f);
    }
    const pair = parsePairKey(f.key);
    if (pair) {
      let g = pairGroups.get(pair.prefix);
      if (!g) {
        g = new Map();
        pairGroups.set(pair.prefix, g);
      }
      g.set(pair.side, f);
    }
  }

  const completeCorners = new Set<string>();
  for (const [prefix, g] of cornerGroups) {
    if (g.has("ff") && g.has("fr") && g.has("rf") && g.has("rr")) {
      completeCorners.add(prefix);
    }
  }

  const completePairs = new Set<string>();
  for (const [prefix, g] of pairGroups) {
    if (g.has("front") && g.has("rear")) completePairs.add(prefix);
  }

  for (const f of sorted) {
    if (consumed.has(f.key)) continue;

    const corner = parseCornerKey(f.key);
    if (corner && completeCorners.has(corner.prefix)) {
      const g = cornerGroups.get(corner.prefix)!;
      const cornerFields = [g.get("ff")!, g.get("fr")!, g.get("rf")!, g.get("rr")!];
      rows.push({
        type: "corner4",
        label: inferGroupLabel(cornerFields, corner.prefix),
        ff: g.get("ff")!.key,
        fr: g.get("fr")!.key,
        rf: g.get("rf")!.key,
        rr: g.get("rr")!.key,
        unit: pickSharedUnit(cornerFields),
      });
      for (const cf of cornerFields) consumed.add(cf.key);
      continue;
    }

    const pair = parsePairKey(f.key);
    if (pair && completePairs.has(pair.prefix)) {
      const g = pairGroups.get(pair.prefix)!;
      const pairFields = [g.get("front")!, g.get("rear")!];
      rows.push({
        type: "pair",
        label: inferGroupLabel(pairFields, pair.prefix),
        leftKey: g.get("front")!.key,
        rightKey: g.get("rear")!.key,
        unit: pickSharedUnit(pairFields),
      });
      consumed.add(g.get("front")!.key);
      consumed.add(g.get("rear")!.key);
      continue;
    }

    rows.push({
      type: "single",
      key: f.key,
      label: f.displayLabel,
      unit: f.unit,
      multiline: f.uiType === "textarea",
    });
    consumed.add(f.key);
  }

  return rows;
}

/** Insert special rows after the row that references their anchor key, or append. */
function mergeSpecialRows(
  inferred: SetupSheetModelLayoutRow[],
  specialRows: SetupSheetModelLayoutRow[]
): SetupSheetModelLayoutRow[] {
  if (specialRows.length === 0) return inferred;

  const out = [...inferred];
  for (const special of specialRows) {
    if (out.some((r) => layoutRowsEqual(r, special))) continue;

    const anchorIdx = findAnchorIndex(out, special);
    if (anchorIdx >= 0) {
      out.splice(anchorIdx + 1, 0, special);
    } else {
      out.push(special);
    }
  }
  return out;
}

function findAnchorIndex(rows: SetupSheetModelLayoutRow[], special: SetupSheetModelLayoutRow): number {
  if (special.type === "screw_strip") {
    if (special.key === "top_deck_screws" || special.key === "top_deck_cuts") {
      return rows.findIndex(
        (r) =>
          (r.type === "pair" && (r.leftKey === "top_deck_front" || r.rightKey === "top_deck_rear"))
          || (r.type === "single" && r.key === "top_deck_single")
      );
    }
    if (special.key === "motor_mount_screws") {
      return rows.findIndex((r) => r.type === "pair" || r.type === "corner4");
    }
  }
  if (special.type === "top_deck_block") {
    return rows.findIndex(
      (r) =>
        (r.type === "pair" && (r.leftKey === "top_deck_front" || r.rightKey === "top_deck_rear"))
        || r.type === "screw_strip"
    );
  }
  return -1;
}

function layoutRowsEqual(a: SetupSheetModelLayoutRow, b: SetupSheetModelLayoutRow): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "single" && b.type === "single") return a.key === b.key;
  if (a.type === "pair" && b.type === "pair") return a.leftKey === b.leftKey && a.rightKey === b.rightKey;
  if (a.type === "corner4" && b.type === "corner4") {
    return a.ff === b.ff && a.fr === b.fr && a.rf === b.rf && a.rr === b.rr;
  }
  if (a.type === "screw_strip" && b.type === "screw_strip") return a.key === b.key;
  return true;
}

