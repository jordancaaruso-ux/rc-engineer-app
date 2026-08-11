import "server-only";

import { prisma } from "@/lib/prisma";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { isPlaceholderLabel } from "@/lib/setupSheetModels/sheetPlan";

/**
 * Every setup sheet a driver has uploaded, in one place, for the founder to work through.
 *
 * ============================== WHY IT READS THE BLANK, NOT THE CHASSIS ==============================
 *
 * The review page already lists chassis a driver built, by asking for models with `userId` set and
 * `isAuthorized` false. That misses two whole categories of the thing this queue exists for:
 *
 *  - **A file that could not be used at all.** A flat PDF never becomes a chassis, so there is no
 *    model row to find. It is kept precisely so the founder can make it fillable himself, and
 *    without this it is kept where nobody looks.
 *  - **A chassis whose uploader left.** `SetupSheetModel.userId` is `SetNull` on account deletion,
 *    so a deleted account silently removes its chassis from the founder's list — while every other
 *    driver keeps using it. The chassis is global; only the person who happened to upload it first
 *    has gone.
 *
 * `SetupSheetBlank` is the record of the upload itself, so it survives both.
 */

export type BlankQueueChassis = {
  blankId: string;
  modelId: string;
  /** What the app calls this chassis now. */
  chassisName: string;
  /** What the driver typed when they uploaded, if it has since diverged from the chassis name. */
  typedNameIfDifferent: string | null;
  uploaderEmail: string | null;
  uploadedAt: Date;
  pageCount: number;
  /** Boxes on the paper. Fixed at upload — a sheet is a sheet. */
  boxCount: number;
  /**
   * Boxes that carry a real name rather than a position on the paper.
   *
   * Zero for every sheet read off a PDF, and that is not a chore waiting: describing boxes is what
   * the calibration surface is for, and a driver's sheet is useful long before anyone has done it —
   * they fill it, save it, compare it and see what changed, all keyed off the boxes themselves.
   *
   * It stays in the queue because it is the honest answer to "will authorizing this chassis add
   * anything to the community numbers", which is keyed by named parameter and not by box.
   */
  namedCount: number;
  carCount: number;
  isAuthorized: boolean;
};

export type BlankQueueRefusal = {
  blankId: string;
  status: string;
  typedName: string;
  filename: string | null;
  documentId: string | null;
  uploaderEmail: string | null;
  uploadedAt: Date;
};

/** Chassis that share a name. Ordered so the one worth keeping is first. */
export type BlankQueueNameClash = {
  name: string;
  rows: BlankQueueChassis[];
};

export type BlankReviewQueue = {
  waiting: BlankQueueChassis[];
  nameClashes: BlankQueueNameClash[];
  refusals: BlankQueueRefusal[];
  /** Chassis in `waiting`, so the older by-model list can leave them out and not show them twice. */
  modelIdsShown: Set<string>;
};

type BlankRow = {
  id: string;
  createdAt: Date;
  chassisNameTyped: string;
  pageCount: number;
  statsJson: unknown;
  setupSheetModel: {
    id: string;
    name: string;
    isAuthorized: boolean;
    schemaJson: unknown;
    _count: { cars: number };
  } | null;
  uploadedBy: { email: string | null } | null;
};

function boxAndNamedCount(row: BlankRow): { boxCount: number; namedCount: number } {
  const schema = parseSetupSheetModelSchema(row.setupSheetModel?.schemaJson);
  if (schema) {
    const named = schema.fields.filter((f) => !isPlaceholderLabel(f.displayLabel)).length;
    return { boxCount: schema.fields.length, namedCount: named };
  }
  // No readable schema: fall back to what the derivation counted, and claim nothing about names.
  const stats = row.statsJson as { parameterCount?: number } | null;
  return { boxCount: typeof stats?.parameterCount === "number" ? stats.parameterCount : 0, namedCount: 0 };
}

function toChassis(row: BlankRow): BlankQueueChassis | null {
  const model = row.setupSheetModel;
  if (!model) return null;
  const { boxCount, namedCount } = boxAndNamedCount(row);
  const typed = row.chassisNameTyped.trim();
  return {
    blankId: row.id,
    modelId: model.id,
    chassisName: model.name,
    typedNameIfDifferent: typed && typed !== model.name ? typed : null,
    uploaderEmail: row.uploadedBy?.email ?? null,
    uploadedAt: row.createdAt,
    pageCount: row.pageCount,
    boxCount,
    namedCount,
    carCount: model._count.cars,
    isAuthorized: model.isAuthorized,
  };
}

/**
 * Which of two same-named chassis is the one to keep looking at first.
 *
 * A suggestion for the eye, never an instruction to the machine: same-named derived sheets are
 * NOT merged, because the fingerprint already proved they are different files. See
 * `planSetupSheetModelDedupe`.
 */
export function compareNameClashRows(a: BlankQueueChassis, b: BlankQueueChassis): number {
  if (a.isAuthorized !== b.isAuthorized) return a.isAuthorized ? -1 : 1;
  if (a.carCount !== b.carCount) return b.carCount - a.carCount;
  if (a.namedCount !== b.namedCount) return b.namedCount - a.namedCount;
  if (a.boxCount !== b.boxCount) return b.boxCount - a.boxCount;
  return a.uploadedAt.getTime() - b.uploadedAt.getTime();
}

/** Group same-named chassis, keeping only the names that more than one chassis answers to. */
export function groupNameClashes(rows: BlankQueueChassis[]): BlankQueueNameClash[] {
  const byName = new Map<string, BlankQueueChassis[]>();
  for (const row of rows) {
    const key = row.chassisName.trim().toLowerCase();
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), row]);
  }
  const out: BlankQueueNameClash[] = [];
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    const ordered = [...list].sort(compareNameClashRows);
    out.push({ name: ordered[0]!.chassisName, rows: ordered });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const BLANK_ROW_SELECT = {
  id: true,
  createdAt: true,
  chassisNameTyped: true,
  pageCount: true,
  statsJson: true,
  setupSheetModel: {
    select: {
      id: true,
      name: true,
      isAuthorized: true,
      schemaJson: true,
      _count: { select: { cars: true } },
    },
  },
  uploadedBy: { select: { email: true } },
} as const;

/**
 * Read the queue.
 *
 * `schemaJson` is pulled per row because how many boxes are described is the number that says
 * whether authorizing a chassis will add anything to the community numbers, and only the live
 * schema knows it — the derivation stats were true the day the file arrived and never move again.
 * That makes each row a few tens of kilobytes, which is why `take` is small: this is a founder's
 * working list, not a catalog.
 */
export async function loadBlankReviewQueue(take = 25): Promise<BlankReviewQueue> {
  const [fillable, refused] = await Promise.all([
    prisma.setupSheetBlank.findMany({
      where: { status: "FILLABLE", setupSheetModelId: { not: null } },
      orderBy: { createdAt: "desc" },
      take,
      select: BLANK_ROW_SELECT,
    }),
    prisma.setupSheetBlank.findMany({
      where: { status: { not: "FILLABLE" }, reviewedAt: null },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        status: true,
        createdAt: true,
        chassisNameTyped: true,
        setupDocument: { select: { id: true, originalFilename: true } },
        uploadedBy: { select: { email: true } },
      },
    }),
  ]);

  const all = fillable.map(toChassis).filter((r): r is BlankQueueChassis => r !== null);

  return {
    // Authorizing is what finishes a chassis, so that — not a reviewed-at stamp — is what takes it
    // off the list. A chassis stays here while it is still outside the community numbers.
    waiting: all.filter((r) => !r.isAuthorized),
    // Clashes are computed over ALL of them, authorized included: a second sheet arriving under the
    // name of a chassis already curated is exactly the case worth seeing.
    nameClashes: groupNameClashes(all),
    refusals: refused.map((r) => ({
      blankId: r.id,
      status: r.status,
      typedName: r.chassisNameTyped,
      filename: r.setupDocument?.originalFilename ?? null,
      documentId: r.setupDocument?.id ?? null,
      uploaderEmail: r.uploadedBy?.email ?? null,
      uploadedAt: r.createdAt,
    })),
    modelIdsShown: new Set(all.filter((r) => !r.isAuthorized).map((r) => r.modelId)),
  };
}
