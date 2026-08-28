import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  MYRCM_PDF_PARSER_ID,
  MyRcmPdfParseError,
  parseMyRcmPdfReport,
  toLapUrlParseResult,
  type MyRcmPdfIssue,
  type MyRcmPdfReport,
} from "@/lib/lapUrlParsers/myRcmPdf";
import { extractMyRcmPdfCells, MyRcmPdfReadError } from "@/lib/lapUrlParsers/myRcmPdfText";
import { MYRCM_PDF_SOURCE_PREFIX } from "@/lib/lapUrlParsers/myRcmPdfSource";
import { computeImportedSessionFieldStatsFromParse } from "@/lib/lapImport/computeImportedSessionFieldStats";
import { serializeParsePayload } from "@/lib/lapImport/service";

/**
 * Persist a MyRCM run result the **driver** downloaded and handed us.
 *
 * Deliberately not part of `importOneTimingUrl`: that function's first act is to validate and then
 * fetch a URL, and `myrcm.ch` is on the fetch denylist precisely so that can never happen. This
 * path takes bytes and never learns of a URL at all.
 *
 * Everything after parsing is the shared machinery — the same `parsedPayload`, the same field
 * stats, the same row — so a PDF-sourced run behaves identically downstream to a LiveRC one.
 */

/** Matches `ImportedLapTimeSession.sourceType` for the dormant HTML reader, so history and the
 *  source filters already know the word. `parserId` is what distinguishes a PDF import. */
const SOURCE_TYPE = "myrcm";

export type ImportMyRcmPdfResult =
  | {
      success: true;
      importedSessionId: string;
      recordedAt: string;
      sessionCompletedAtIso: string | null;
      sessionCompletedAtDbIso: string | null;
      parserId: string;
      sourceUrl: string;
      /** Whether this file had already been imported by this user. */
      alreadyImported: boolean;
      report: MyRcmPdfReport;
      laps: number[];
      /** Non-blocking notes worth showing — currently only missed transponder crossings. */
      warnings: MyRcmPdfIssue[];
      /** True when the driver's own row could not be matched by name; they must pick. */
      driverNotFound: boolean;
    }
  | {
      success: false;
      /** Safe to show a driver as-is; every one names the next thing to do. */
      error: string;
      code: string;
      /** Present when the file parsed but its own numbers disagreed. */
      issues?: MyRcmPdfIssue[];
    };

/**
 * A `sourceUrl` that cannot be mistaken for something fetchable.
 *
 * The column is required and there is no URL, so this scheme carries the file's fingerprint
 * instead — which doubles as the key that recognises the same result being uploaded twice.
 */
function syntheticSourceUrl(bytes: Uint8Array, fileName: string | null): string {
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const safeName = (fileName ?? "report.pdf")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${MYRCM_PDF_SOURCE_PREFIX}${digest}/${safeName || "report.pdf"}`;
}

export async function importMyRcmPdf(params: {
  userId: string;
  bytes: Uint8Array;
  fileName?: string | null;
  /** Every name the driver races under on MyRCM — the only handle their results carry. */
  driverNames?: string[];
}): Promise<ImportMyRcmPdfResult> {
  const { userId, bytes, fileName = null, driverNames } = params;

  /*
   * Fingerprinted BEFORE the PDF is opened. pdf.js takes ownership of the buffer it is
   * handed and detaches it, so after `extractMyRcmPdfCells` these bytes read as empty —
   * and the digest of nothing is the same for every file. Every upload was landing on
   * `myrcm-pdf://e3b0c44298fc1c14/<filename>`, so two different races whose downloads
   * shared a name (MyRCM reuses `report-<event>-<section>-<n>.pdf`) were one row, the
   * second silently overwriting the first's laps (found 2026-08-27, "I've imported a
   * bunch and they're not there").
   */
  const sourceUrl = syntheticSourceUrl(bytes, fileName);

  let report: MyRcmPdfReport;
  try {
    report = parseMyRcmPdfReport(await extractMyRcmPdfCells(bytes));
  } catch (error) {
    if (error instanceof MyRcmPdfReadError || error instanceof MyRcmPdfParseError) {
      return { success: false, error: error.message, code: error.code };
    }
    return {
      success: false,
      error: "This PDF couldn't be read. If it opens on your phone, it may be a format we don't handle yet.",
      code: "unknown",
    };
  }

  // The gate. A wrong lap time is worse than a missing one, because the Engineer advises on it.
  if (!report.reconciled) {
    // Logged with the file's shape, so a refusal can be diagnosed from the server without the
    // file: which export options were ticked shows in the driver count and the issue pattern.
    console.warn("[myrcm-pdf]", "did_not_reconcile", {
      fileName,
      session: report.sessionName,
      drivers: report.drivers.length,
      withLaps: report.drivers.filter((d) => d.laps.length > 0).length,
      issues: report.issues.map((issue) => `${issue.driverName}: ${issue.detail}`),
    });
    return {
      success: false,
      error:
        "The lap times in this file don't add up to the totals it prints, so we haven't saved anything.",
      code: "did_not_reconcile",
      issues: report.issues.filter((issue) => issue.severity === "error"),
    };
  }

  const parsed = toLapUrlParseResult(report, { driverNames });

  const rawIso = parsed.sessionCompletedAtIso?.trim();
  let sessionCompletedAt: Date | null = null;
  if (rawIso) {
    const when = new Date(rawIso);
    if (!Number.isNaN(when.getTime())) sessionCompletedAt = when;
  }

  const payload = serializeParsePayload(parsed) as Prisma.InputJsonValue;
  const fieldStats = computeImportedSessionFieldStatsFromParse(parsed);
  const fieldStatsJson: Prisma.InputJsonValue | typeof Prisma.DbNull =
    fieldStats === null ? Prisma.DbNull : (fieldStats as Prisma.InputJsonValue);

  /*
   * Rows written before the fingerprint fix all carry the digest of the empty file (see
   * `syntheticSourceUrl`'s caller above), so a re-upload of one of those files would never
   * match by its real fingerprint and would land as a second row. Fall back to the legacy
   * URL — same user, same filename, empty-file hash — and correct it on the way through.
   */
  const legacySourceUrl = syntheticSourceUrl(new Uint8Array(0), fileName);
  const existing =
    (await prisma.importedLapTimeSession.findFirst({
      where: { userId, sourceUrl },
      select: { id: true },
    })) ??
    (await prisma.importedLapTimeSession.findFirst({
      where: { userId, sourceUrl: legacySourceUrl },
      select: { id: true },
    }));

  const row = existing
    ? await prisma.importedLapTimeSession.update({
        where: { id: existing.id },
        data: {
          sourceUrl,
          parserId: MYRCM_PDF_PARSER_ID,
          parsedPayload: payload,
          sessionCompletedAt,
          fieldStatsJson,
        },
        select: { id: true, createdAt: true, sessionCompletedAt: true },
      })
    : await prisma.importedLapTimeSession.create({
        data: {
          userId,
          sourceUrl,
          parserId: MYRCM_PDF_PARSER_ID,
          sourceType: SOURCE_TYPE,
          parsedPayload: payload,
          sessionCompletedAt,
          fieldStatsJson,
        },
        select: { id: true, createdAt: true, sessionCompletedAt: true },
      });

  return {
    success: true,
    importedSessionId: row.id,
    recordedAt: row.createdAt.toISOString(),
    sessionCompletedAtIso: sessionCompletedAt ? sessionCompletedAt.toISOString() : null,
    sessionCompletedAtDbIso: row.sessionCompletedAt ? row.sessionCompletedAt.toISOString() : null,
    parserId: MYRCM_PDF_PARSER_ID,
    sourceUrl,
    alreadyImported: Boolean(existing),
    report,
    laps: parsed.laps,
    warnings: report.issues.filter((issue) => issue.severity === "warning"),
    driverNotFound: parsed.errorCode === "driver_not_found",
  };
}
