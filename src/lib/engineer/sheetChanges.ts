import { normalizeSetupData } from "@/lib/runSetup";
import { fmtSetupValue, isEngineerSetupKey, readableSetupKey, sameSetupValue } from "@/lib/engineer/setupDiff";

/**
 * What a setup-change link opens (sheetLinks.ts): every box that moved between two runs of one car,
 * in the order they sit on the sheet, numbered the way they are ringed.
 *
 * "Moved" is decided exactly as the Engineer's "changed" line decides it on a sheet it can barely
 * read (setupDiff `diffSheet`): every filled box, compared as the Engineer compares values. So when
 * the Engineer says "2 boxes not shown here", the sheet this opens rings those two boxes and the
 * readable changes on the same line, and nothing else.
 *
 * Pure — no database — so the page's numbers can be tested on hand-built sheets.
 */

export type SheetChangeRow = {
  key: string;
  /** Its number on the sheet, 1 up in reading order; null when this sheet has no box for the key. */
  number: number | null;
  pageNumber: number | null;
  /** As the Engineer reads it (`fmtSetupValue`); null when the box was empty on that side. */
  before: string | null;
  after: string | null;
  /** The app's own name for a box the Engineer can read ("pinion"); null for a box it cannot. */
  known: string | null;
  /** What this driver called the box on this car before (carSheetNames.ts); null if never named. */
  savedName: string | null;
};

type Box = { key: string; pageNumber: number; x: number; y: number };

/** Where a key first appears on the sheet: its top-left-most box, page first. */
function firstBoxByKey(boxes: ReadonlyArray<Box>): Map<string, Box> {
  const out = new Map<string, Box>();
  for (const b of boxes) {
    const seen = out.get(b.key);
    if (
      !seen ||
      b.pageNumber < seen.pageNumber ||
      (b.pageNumber === seen.pageNumber && (b.y < seen.y || (b.y === seen.y && b.x < seen.x)))
    ) {
      out.set(b.key, b);
    }
  }
  return out;
}

export function sheetChangeRows(params: {
  before: unknown;
  after: unknown;
  boxes: ReadonlyArray<Box>;
  savedNames?: Readonly<Record<string, string>>;
}): SheetChangeRow[] {
  const before = normalizeSetupData(params.before);
  const after = normalizeSetupData(params.after);
  const where = firstBoxByKey(params.boxes);

  const rows: Array<Omit<SheetChangeRow, "number">> = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const b = fmtSetupValue(before[key]);
    const a = fmtSetupValue(after[key]);
    if (sameSetupValue(b ?? undefined, a ?? undefined)) continue;
    rows.push({
      key,
      pageNumber: where.get(key)?.pageNumber ?? null,
      before: b,
      after: a,
      known: isEngineerSetupKey(key) ? readableSetupKey(key) : null,
      savedName: params.savedNames?.[key]?.trim() || null,
    });
  }

  // Reading order — down the page, then across — so ring 1 is the one the eye meets first. A key
  // with no box on this sheet goes last, unnumbered: still a change, just not one to ring.
  rows.sort((p, q) => {
    const bp = where.get(p.key);
    const bq = where.get(q.key);
    if (!bp || !bq) return bp ? -1 : bq ? 1 : p.key.localeCompare(q.key);
    if (bp.pageNumber !== bq.pageNumber) return bp.pageNumber - bq.pageNumber;
    if (bp.y !== bq.y) return bp.y - bq.y;
    return bp.x - bq.x;
  });

  let n = 0;
  return rows.map((r) => ({ ...r, number: r.pageNumber != null ? ++n : null }));
}

/**
 * The driver's next message, in their words: "Before my 14:06 run I changed the front roll bar
 * 1.2 → 1.4 and the front spring C=2.3 → C=2.5."
 *
 * The values are written the way the Engineer's own data writes a change (`a → b`, "—" for an
 * empty box), so the answer can line them up with the run it already has in front of it.
 */
export function namedChangesMessage(params: {
  /** "14:06", or null when the run's clock is not known. */
  clock: string | null;
  /** "Sat 23 May" when the two runs were on different days; null on the same day. */
  dayLabel?: string | null;
  changes: ReadonlyArray<{ name: string; before: string | null; after: string | null }>;
}): string | null {
  const parts = params.changes
    .map((c) => ({ ...c, name: c.name.trim().replace(/\s+/g, " ").replace(/^the\s+/i, "") }))
    .filter((c) => c.name.length > 0)
    // "Front roll bar" reads "the front roll bar" mid-sentence; "ARB" stays "ARB".
    .map((c) => ({ ...c, name: /^[A-Z][a-z]/.test(c.name) ? c.name[0].toLowerCase() + c.name.slice(1) : c.name }))
    .map((c) => `the ${c.name} ${c.before ?? "—"} → ${c.after ?? "—"}`);
  if (parts.length === 0) return null;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const run = params.clock ? `my ${params.clock} run` : "that run";
  const day = params.dayLabel ? ` on ${params.dayLabel}` : "";
  return `Before ${run}${day} I changed ${list}.`;
}
