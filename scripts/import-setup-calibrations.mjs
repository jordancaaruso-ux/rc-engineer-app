/**
 * Import SetupSheetCalibration rows from backups/setup-calibrations-*.json
 *
 * Usage:
 *   node scripts/import-setup-calibrations.mjs [path/to/backup.json]
 *   node scripts/import-setup-calibrations.mjs --dry-run [path/to/backup.json]
 *
 * --dry-run: no writes; validates backup rows and (if DB is reachable) read-only
 *   check for existing ids → would-create vs would-update counts.
 */

import { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";
import path from "node:path";

/** Fields required by Prisma model SetupSheetCalibration for create/upsert. */
const REQUIRED_KEYS = ["id", "userId", "name", "sourceType", "calibrationDataJson"];

function parseArgs(argv) {
  const rest = argv.slice(2);
  const dryRun = rest.includes("--dry-run");
  const positional = rest.filter((a) => a !== "--dry-run");
  return { dryRun, fileArg: positional[0] ?? null };
}

function resolveBackupPath(fileArg) {
  return fileArg
    ? path.isAbsolute(fileArg)
      ? fileArg
      : path.join(process.cwd(), fileArg)
    : path.join(process.cwd(), "backups", "setup-calibrations-2026-03-31T01-36-00-035Z.json");
}

/**
 * Json field in Prisma accepts object or array; reject primitives/null for calibration payload.
 */
function isValidCalibrationJson(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "object") return true;
  return false;
}

function validateRow(c, index) {
  if (!c || typeof c !== "object") {
    return { ok: false, reason: `row ${index}: not an object` };
  }
  const missing = REQUIRED_KEYS.filter((k) => {
    if (k === "calibrationDataJson") return !isValidCalibrationJson(c.calibrationDataJson);
    const v = c[k];
    return typeof v !== "string" || !String(v).trim();
  });
  if (missing.length) {
    return { ok: false, reason: `row ${index}: missing/invalid ${missing.join(", ")}` };
  }
  if (c.exampleDocumentId != null && typeof c.exampleDocumentId !== "string") {
    return { ok: false, reason: `row ${index}: exampleDocumentId must be string or null` };
  }
  return {
    ok: true,
    row: {
      id: c.id,
      userId: c.userId,
      name: c.name,
      sourceType: c.sourceType,
      calibrationDataJson: c.calibrationDataJson,
      exampleDocumentId: typeof c.exampleDocumentId === "string" ? c.exampleDocumentId : null,
    },
  };
}

async function dryRun(backupPath, validRows) {
  // eslint-disable-next-line no-console
  console.log(`[dry-run] file=${backupPath}`);
  // eslint-disable-next-line no-console
  console.log(`[dry-run] valid rows ready for upsert: ${validRows.length}`);

  const prisma = new PrismaClient({ log: [] });
  try {
    const ids = validRows.map((r) => r.id);
    const existing = await prisma.setupSheetCalibration.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const existingSet = new Set(existing.map((e) => e.id));
    let wouldCreate = 0;
    let wouldUpdate = 0;
    for (const r of validRows) {
      if (existingSet.has(r.id)) wouldUpdate++;
      else wouldCreate++;
    }
    // eslint-disable-next-line no-console
    console.log(`[dry-run] read-only DB check: would create=${wouldCreate} would update=${wouldUpdate}`);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log(
      `[dry-run] could not query DB (skipped read-only check): ${e instanceof Error ? e.message : String(e)}`
    );
    // eslint-disable-next-line no-console
    console.log(`[dry-run] file-only: ${validRows.length} row(s) would be passed to upsert if import runs`);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Fresh Postgres has no users/documents; calibrations reference User and optionally SetupDocument.
 * Insert minimal placeholder rows (no deletes) so upserts succeed and FKs stay valid.
 */
async function ensureForeignKeyPrerequisites(prisma, validRows) {
  const userIds = [...new Set(validRows.map((r) => r.userId))];
  let usersCreated = 0;
  for (const id of userIds) {
    const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (exists) continue;
    await prisma.user.create({
      data: {
        id,
        email: `calibration-import-${id}@placeholder.invalid`,
        name: "Calibration import (placeholder user)",
      },
    });
    usersCreated++;
  }

  const docToUser = new Map();
  for (const r of validRows) {
    if (r.exampleDocumentId)
      docToUser.set(r.exampleDocumentId, r.userId);
  }
  let docsCreated = 0;
  for (const [docId, userId] of docToUser) {
    const exists = await prisma.setupDocument.findUnique({ where: { id: docId }, select: { id: true } });
    if (exists) continue;
    await prisma.setupDocument.create({
      data: {
        id: docId,
        userId,
        originalFilename: "__calibration_import_placeholder__.pdf",
        storagePath: "__calibration_import__/placeholder.pdf",
        mimeType: "application/pdf",
        sourceType: "PDF",
      },
    });
    docsCreated++;
  }

  // eslint-disable-next-line no-console
  console.log(
    `[import] FK prerequisites: users created=${usersCreated}/${userIds.size}, example docs created=${docsCreated}/${docToUser.size}`
  );
}

async function importRows(validRows) {
  const prisma = new PrismaClient({ log: ["error", "warn"] });
  let created = 0;
  let updated = 0;
  try {
    await ensureForeignKeyPrerequisites(prisma, validRows);
    for (const r of validRows) {
      const row = await prisma.setupSheetCalibration.upsert({
        where: { id: r.id },
        create: {
          id: r.id,
          userId: r.userId,
          name: r.name,
          sourceType: r.sourceType,
          calibrationDataJson: r.calibrationDataJson,
          exampleDocumentId: r.exampleDocumentId,
        },
        update: {
          userId: r.userId,
          name: r.name,
          sourceType: r.sourceType,
          calibrationDataJson: r.calibrationDataJson,
          exampleDocumentId: r.exampleDocumentId,
        },
        select: { id: true, createdAt: true, updatedAt: true },
      });
      if (row.createdAt.getTime() === row.updatedAt.getTime()) created++;
      else updated++;
    }
    const totalInDb = await prisma.setupSheetCalibration.count();
    // eslint-disable-next-line no-console
    console.log(`[import] created=${created} updated=${updated} total in DB=${totalInDb}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const { dryRun: isDry, fileArg } = parseArgs(process.argv);
  const backupPath = resolveBackupPath(fileArg);

  const raw = await readFile(backupPath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON: ${backupPath}`);
  }

  const calibrations = Array.isArray(parsed?.calibrations) ? parsed.calibrations : [];
  if (!calibrations.length) {
    throw new Error(`No calibrations array or empty: ${backupPath}`);
  }

  const validRows = [];
  const skipReasons = [];
  for (let i = 0; i < calibrations.length; i++) {
    const v = validateRow(calibrations[i], i);
    if (v.ok) validRows.push(v.row);
    else skipReasons.push(v.reason);
  }

  // eslint-disable-next-line no-console
  console.log(`[backup] total entries in file: ${calibrations.length}`);
  // eslint-disable-next-line no-console
  console.log(`[backup] valid for import: ${validRows.length} skipped: ${skipReasons.length}`);

  if (skipReasons.length && skipReasons.length <= 15) {
    for (const s of skipReasons) {
      // eslint-disable-next-line no-console
      console.log(`[backup] skip: ${s}`);
    }
  } else if (skipReasons.length) {
    // eslint-disable-next-line no-console
    console.log(`[backup] (first 10 skip reasons)`);
    for (const s of skipReasons.slice(0, 10)) {
      // eslint-disable-next-line no-console
      console.log(`[backup] skip: ${s}`);
    }
  }

  /** Schema compatibility: backup declares count vs parsed valid */
  const declaredCount = typeof parsed.count === "number" ? parsed.count : null;
  if (declaredCount != null && declaredCount !== calibrations.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[compat] backup "count" (${declaredCount}) !== calibrations.length (${calibrations.length})`
    );
  }

  if (isDry) {
    await dryRun(backupPath, validRows);
    return;
  }

  await importRows(validRows);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("[import-setup-calibrations] failed:", e);
  process.exitCode = 1;
});
