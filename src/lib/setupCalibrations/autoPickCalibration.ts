import "server-only";

import { prisma } from "@/lib/prisma";
import { calibrationsAutoPickableByUserWhere } from "@/lib/setupCalibrations/calibrationAccess";
import { calibrationMappingCounts, normalizeCalibrationData } from "@/lib/setupCalibrations/types";
import { normalizeSetupSheetModelName } from "@/lib/setupSheetModels/normalizeModelName";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";
import {
  fingerprintPdfFormFieldsFromBytes,
  jaccardSimilarity,
} from "@/lib/setupCalibrations/pdfFormFingerprint";

export type CalibrationFingerprint = {
  calibrationId: string;
  calibrationName: string;
  names: string[];
  setupSheetModelId: string | null;
  setupSheetModelName: string | null;
};

export type ChassisCandidate = { modelId: string; modelName: string };

export type RepickOutcome = {
  pickedCalibrationId: string | null;
  pickedCalibrationName: string | null;
  /** `edition_derived`: no calibration matched, so the sheet was learned as a new EDITION of the
   *  car's chassis and read through the calibration that minting created. See
   *  `createSheetEditionForModel`. */
  pickSource: "exact_fingerprint" | "ambiguous_suggestion" | "needs_disambiguation" | "edition_derived" | "none";
  pickDebug: string;
  /**
   * Set only when `pickSource === "needs_disambiguation"`: the distinct chassis models whose
   * calibrations all match this PDF's fingerprint. Nothing is auto-applied — the caller must
   * disambiguate (filename/garage hint, then ask the driver which chassis it is).
   */
  crossModelCandidates?: ChassisCandidate[];
};

export type ExactPickResult =
  | { kind: "exact"; calibrationId: string; calibrationName: string }
  | { kind: "none"; closestName: string | null; closestScore: number }
  | {
      kind: "ambiguous";
      names: string[];
      suggestedCalibrationId: string;
      suggestedCalibrationName: string;
    }
  | {
      // Multiple exact fingerprint matches spanning >1 distinct chassis model (e.g. Mugen MTC3 and
      // Awesomatix A800RR share the same generic AcroForm field names). Not auto-applied — the
      // wrong chassis silently mis-templates the whole sheet. Caller must disambiguate.
      kind: "ambiguous_cross_model";
      candidates: CalibrationFingerprint[];
      models: ChassisCandidate[];
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
  /** When set, only calibrations for this setup sheet model (plus none for community without model). */
  restrictToSetupSheetModelId?: string | null;
  minNameCount?: number;
}): Promise<CalibrationFingerprint[]> {
  const minNameCount = input.minNameCount ?? 8;
  const modelId = input.restrictToSetupSheetModelId?.trim() || null;
  const calibrations = await prisma.setupSheetCalibration.findMany({
    where: {
      ...calibrationsAutoPickableByUserWhere(input.userId),
      ...(input.restrictToNames && input.restrictToNames.length > 0
        ? { name: { in: [...input.restrictToNames] } }
        : {}),
      ...(modelId ? { setupSheetModelId: modelId } : {}),
    },
    select: {
      id: true,
      name: true,
      exampleDocumentId: true,
      createdAt: true,
      setupSheetModelId: true,
      setupSheetModel: { select: { name: true } },
      calibrationDataJson: true,
    },
    orderBy: { createdAt: "desc" },
  });
  // Drop empty shells. The calibration editor's normal flow is "create the row, then map its
  // fields", so a calibration with an example PDF but zero mappings of any kind is a half-finished
  // template — yet it fingerprint-matches its own source sheet perfectly and would win the exact
  // pick, silently importing every future copy of that sheet as blank. Filtered BEFORE the
  // name-dedupe below so a newer empty shell cannot shadow an older working calibration.
  const mapped = calibrations.filter((c) => {
    const counts = calibrationMappingCounts(normalizeCalibrationData(c.calibrationDataJson));
    return counts.formFields + counts.textFields + counts.regionFields + counts.imageFields > 0;
  });

  // Collapse duplicates by name → keep the most recently created entry. Historical cleanup can leave
  // multiple rows with the same name pointing at the same example PDF; without this, the exact-match
  // picker would flag every PDF of that template as ambiguous.
  const bestByName = new Map<string, (typeof calibrations)[number]>();
  for (const c of mapped) {
    if (!bestByName.has(c.name)) bestByName.set(c.name, c);
  }
  const deduped = [...bestByName.values()];

  const exampleIds = deduped.map((c) => c.exampleDocumentId).filter(Boolean) as string[];
  if (exampleIds.length === 0) return [];

  // Example PDFs can belong to the calibration author; community-shared cals use their example doc.
  const docs = await prisma.setupDocument.findMany({
    where: { id: { in: exampleIds } },
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
      out.push({
        calibrationId: c.id,
        calibrationName: c.name,
        names: fp.names,
        setupSheetModelId: c.setupSheetModelId,
        setupSheetModelName: c.setupSheetModel?.name ?? null,
      });
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
    // Distinct linked chassis among the matches (collapse duplicate model rows by normalized name;
    // unlinked/null-model calibrations are generic and don't identify a chassis).
    const modelByNorm = new Map<string, ChassisCandidate>();
    for (const m of matches) {
      const modelId = m.setupSheetModelId?.trim() || null;
      const modelName = m.setupSheetModelName?.trim() || null;
      if (!modelId || !modelName) continue;
      const norm = normalizeSetupSheetModelName(modelName);
      if (!modelByNorm.has(norm)) modelByNorm.set(norm, { modelId, modelName });
    }
    if (modelByNorm.size >= 2) {
      return {
        kind: "ambiguous_cross_model",
        candidates: matches,
        models: [...modelByNorm.values()],
        suggestedCalibrationId: first.calibrationId,
        suggestedCalibrationName: first.calibrationName,
      };
    }
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
  if (result.kind === "ambiguous_cross_model") {
    // Never auto-apply across chassis — the fingerprint can't tell them apart. Hand the distinct
    // models back for filename/garage disambiguation or a tap-to-answer chassis question.
    return {
      pickedCalibrationId: null,
      pickedCalibrationName: null,
      pickSource: "needs_disambiguation",
      pickDebug: `${prefix} ambiguous_cross_model (${result.models.map((m) => m.modelName).join(" | ")})`,
      crossModelCandidates: result.models,
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
