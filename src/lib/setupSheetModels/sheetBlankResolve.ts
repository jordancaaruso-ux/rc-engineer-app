import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseStoredBoxes } from "@/lib/setupSheetModels/sheetPlan";

/**
 * Which of a chassis's sheets is THIS setup written on?
 *
 * ============================== WHY A CHASSIS HAS SEVERAL SHEETS ==============================
 *
 * Since 2026-08-16 a `SetupSheetModel` holds one PRIMARY blank plus any number of EDITIONS —
 * rebuilt PDFs of the same sheet where somebody renamed every AcroForm box (see
 * `createSheetEditionForModel`). A setup imported through an edition stores its values under that
 * edition's keys, so drawing it over the primary blank shows empty boxes: the paper is right, the
 * vocabulary is not. Every surface that shows a setup ON its sheet therefore has to pick the blank
 * whose boxes actually speak the setup's keys.
 *
 * ============================== WHY THE PICK IS BY KEY OVERLAP ==============================
 *
 * A setup does not carry a pointer to its edition, and it must not: run snapshots are copied from
 * other snapshots, baselines are authored in the app, and a driver can edit an imported setup for
 * a season — all of which would go stale or wrong through any chain of provenance links. What a
 * setup DOES carry, always and immutably, is its keys. Counting how many of them each blank's
 * boxes can draw is a measurement of the only thing that matters here — which paper can show these
 * values — and it works identically for a fresh import, a fifth-generation run copy, and a setup
 * whose document is long deleted.
 *
 * Ties (and the empty setup) go to the primary blank, so a chassis with no editions behaves
 * exactly as it did when blank↔model was 1:1.
 */

export const SHEET_BLANK_PICK_SELECT = {
  id: true,
  isEdition: true,
  boxesJson: true,
  fillSurface: true,
  pageCount: true,
  schemaFieldsJson: true,
} satisfies Prisma.SetupSheetBlankSelect;

export type PickedSheetBlank = Prisma.SetupSheetBlankGetPayload<{
  select: typeof SHEET_BLANK_PICK_SELECT;
}>;

/** The blank the chassis had when blank↔model was 1:1 — oldest non-edition row wins. */
export function wherePrimarySheetBlank(
  setupSheetModelId: string
): Prisma.SetupSheetBlankWhereInput {
  return { setupSheetModelId, isEdition: false };
}

/** How many of this setup's keys the blank's boxes can draw. Pure, for tests. */
export function scoreBlankForKeys(boxesJson: unknown, dataKeys: ReadonlySet<string>): number {
  let score = 0;
  const counted = new Set<string>();
  for (const box of parseStoredBoxes(boxesJson)) {
    if (counted.has(box.key)) continue;
    if (dataKeys.has(box.key)) {
      counted.add(box.key);
      score += 1;
    }
  }
  return score;
}

/**
 * The blank a setup should be drawn on. Null when the chassis has no blanks at all (a hand-mapped
 * chassis with no sheet), in which case the caller falls back to the form.
 *
 * The stamp outranks the keys (founder ruling 2026-08-31: the paper a driver uploaded is the paper
 * they see, always). `SetupSnapshot.sheetBlankId` says which paper a setup was born on, and once
 * an edition is ALIGNED to the canonical vocabulary its boxes carry the same keys as the primary's
 * — key overlap then ties on every setup and can no longer tell the papers apart. The overlap
 * measurement stays as the fallback for unstamped setups on a chassis whose edition still speaks
 * its own minted keys.
 */
export async function pickSheetBlankForData(
  setupSheetModelId: string,
  data: Record<string, unknown> | null | undefined,
  opts?: { sheetBlankId?: string | null }
): Promise<PickedSheetBlank | null> {
  const blanks = await prisma.setupSheetBlank.findMany({
    where: { setupSheetModelId, status: "FILLABLE" },
    orderBy: { createdAt: "asc" },
    select: SHEET_BLANK_PICK_SELECT,
  });
  if (blanks.length === 0) return null;

  const primary = blanks.find((b) => !b.isEdition) ?? blanks[0]!;

  // The paper the setup was born on, when it says so and that paper still exists here. A stamp
  // pointing at a retired blank falls through to the measurement rather than erroring.
  const stampedId = opts?.sheetBlankId ?? null;
  if (stampedId) {
    const stamped = blanks.find((b) => b.id === stampedId);
    if (stamped) return stamped;
  }

  if (blanks.length === 1) return primary;

  const dataKeys = new Set(Object.keys(data ?? {}));
  if (dataKeys.size === 0) return primary;

  let best = primary;
  let bestScore = scoreBlankForKeys(primary.boxesJson, dataKeys);
  for (const blank of blanks) {
    if (blank.id === primary.id) continue;
    const score = scoreBlankForKeys(blank.boxesJson, dataKeys);
    // Strictly greater: a tie is not evidence, and the primary is the sheet everyone knows.
    if (score > bestScore) {
      best = blank;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The same pick, shaped for a surface that passes `editionBlankId` to the sheet-plan and
 * sheet-page routes: null means "the primary" (no query param), so URLs for a chassis without
 * editions stay byte-identical to what they were before editions existed — caches included.
 */
export async function editionBlankIdForData(
  setupSheetModelId: string,
  data: Record<string, unknown> | null | undefined,
  opts?: { sheetBlankId?: string | null }
): Promise<string | null> {
  const picked = await pickSheetBlankForData(setupSheetModelId, data, opts);
  return picked && picked.isEdition ? picked.id : null;
}
