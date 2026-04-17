import "server-only";

import { prisma } from "@/lib/prisma";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";
import {
  fingerprintPdfFormFieldsFromBytes,
  jaccardSimilarity,
} from "@/lib/setupCalibrations/pdfFormFingerprint";

export type CalibrationFingerprint = {
  calibrationId: string;
  calibrationName: string;
  names: string[];
};

export type RepickOutcome = {
  pickedCalibrationId: string | null;
  pickedCalibrationName: string | null;
  pickSource: "exact_fingerprint" | "ambiguous_suggestion" | "none";
  pickDebug: string;
};

export type ExactPickResult =
  | { kind: "exact"; calibrationId: string; calibrationName: string }
  | { kind: "none"; closestName: string | null; closestScore: number }
  | {
      kind: "ambiguous";
      names: string[];
      suggestedCalibrationId: string;
      suggestedCalibrationName: string;
    };

/**
 * Build candidate fingerprints from the user's calibrations that have a linked example PDF.
 * When `restrictToNames` is provided, only calibrations whose name is in that set are considered
 * (mirrors the PetitRC allow-list behaviour). When omitted, all of the user's calibrations with
 * a usable example PDF are candidates.
 */
export async function buildCalibrationFingerprints(input: {
  userId: string;
  restrictToNames?: readonly string[];
  minNameCount?: number;
}): Promise<CalibrationFingerprint[]> {
  const minNameCount = input.minNameCount ?? 8;
  const calibrations = await prisma.setupSheetCalibration.findMany({
    where: {
      userId: input.userId,
      ...(input.restrictToNames && input.restrictToNames.length > 0
        ? { name: { in: [...input.restrictToNames] } }
        : {}),
    },
    select: { id: true, name: true, exampleDocumentId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  // Collapse duplicates by name → keep the most recently created entry. Historical cleanup can leave
  // multiple rows with the same name pointing at the same example PDF; without this, the exact-match
  // picker would flag every PDF of that template as ambiguous.
  const bestByName = new Map<string, (typeof calibrations)[number]>();
  for (const c of calibrations) {
    if (!bestByName.has(c.name)) bestByName.set(c.name, c);
  }
  const deduped = [...bestByName.values()];

  const exampleIds = deduped.map((c) => c.exampleDocumentId).filter(Boolean) as string[];
  if (exampleIds.length === 0) return [];

  const docs = await prisma.setupDocument.findMany({
    where: { id: { in: exampleIds }, userId: input.userId },
    select: { id: true, storagePath: true, originalFilename: true, mimeType: true },
  });
  const docById = new Map(docs.map((d) => [d.id, d] as const));

  const out: CalibrationFingerprint[] = [];
  for (const c of deduped) {
    if (!c.exampleDocumentId) continue;
    const doc = docById.get(c.exampleDocumentId);
    if (!doc) continue;
    try {
      const bytes = await readBytesFromStorageRef(doc.storagePath);
      const fp = await fingerprintPdfFormFieldsFromBytes(new Uint8Array(bytes));
      if (fp.names.length < minNameCount) continue;
      out.push({ calibrationId: c.id, calibrationName: c.name, names: fp.names });
    } catch {
      // Skip broken examples
    }
  }
  return out;
}

function fingerprintArraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function pickExactCalibration(
  pdfNames: readonly string[],
  candidates: CalibrationFingerprint[]
): ExactPickResult {
  const matches = candidates.filter((c) => fingerprintArraysEqual(pdfNames, c.names));
  if (matches.length === 1) {
    return {
      kind: "exact",
      calibrationId: matches[0]!.calibrationId,
      calibrationName: matches[0]!.calibrationName,
    };
  }
  if (matches.length > 1) {
    // Candidates are passed in most-recent-first order (see buildCalibrationFingerprints orderBy).
    const first = matches[0]!;
    return {
      kind: "ambiguous",
      names: matches.map((m) => m.calibrationName),
      suggestedCalibrationId: first.calibrationId,
      suggestedCalibrationName: first.calibrationName,
    };
  }
  let closest: { name: string; score: number } | null = null;
  for (const c of candidates) {
    const s = jaccardSimilarity(pdfNames, c.names);
    if (!closest || s > closest.score) closest = { name: c.calibrationName, score: s };
  }
  return { kind: "none", closestName: closest?.name ?? null, closestScore: closest?.score ?? 0 };
}

/**
 * Fingerprint the given PDF bytes and pick an exact matching calibration from the candidate set.
 * `debugPrefix` is prepended to the `pickDebug` string so callers can identify the origin
 * (e.g. `"petitrc:auto"` or `"quickCreate:auto"`).
 */
export async function repickCalibrationForBytes(
  bytes: Uint8Array,
  candidates: CalibrationFingerprint[],
  options: { debugPrefix?: string; suggestOnAmbiguous?: boolean } = {}
): Promise<RepickOutcome> {
  const prefix = options.debugPrefix ?? "auto";
  const suggestOnAmbiguous = options.suggestOnAmbiguous ?? false;
  if (candidates.length === 0) {
    return {
      pickedCalibrationId: null,
      pickedCalibrationName: null,
      pickSource: "none",
      pickDebug: `${prefix} no_candidates (no allowed calibrations with linked example PDFs)`,
    };
  }
  const fp = await fingerprintPdfFormFieldsFromBytes(bytes);
  const result = pickExactCalibration(fp.names, candidates);
  if (result.kind === "exact") {
    return {
      pickedCalibrationId: result.calibrationId,
      pickedCalibrationName: result.calibrationName,
      pickSource: "exact_fingerprint",
      pickDebug: `${prefix} exact=${result.calibrationName}`,
    };
  }
  if (result.kind === "ambiguous") {
    if (suggestOnAmbiguous) {
      return {
        pickedCalibrationId: result.suggestedCalibrationId,
        pickedCalibrationName: result.suggestedCalibrationName,
        pickSource: "ambiguous_suggestion",
        pickDebug: `${prefix} ambiguous (${result.names.join(" | ")}) suggested=${result.suggestedCalibrationName}`,
      };
    }
    return {
      pickedCalibrationId: null,
      pickedCalibrationName: null,
      pickSource: "none",
      pickDebug: `${prefix} ambiguous (${result.names.join(" | ")})`,
    };
  }
  const closestLabel = result.closestName
    ? `${result.closestName} jaccard=${result.closestScore.toFixed(3)}`
    : "no_candidates";
  return {
    pickedCalibrationId: null,
    pickedCalibrationName: null,
    pickSource: "none",
    pickDebug: `${prefix} no_exact_match closest=${closestLabel}`,
  };
}
