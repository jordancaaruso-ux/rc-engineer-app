import "server-only";

import { prisma } from "@/lib/prisma";
import {
  fingerprintImageBytes,
  hammingDistanceHex,
  tokenJaccard,
  type ImageFingerprint,
} from "@/lib/setupCalibrations/imageFingerprint";
import { normalizeCalibrationData } from "@/lib/setupCalibrations/types";
import type { RepickOutcome } from "@/lib/setupCalibrations/autoPickCalibration";

export type ImageCalibrationCandidate = {
  calibrationId: string;
  calibrationName: string;
  pHash64: string;
  headerTokens: string[];
};

/**
 * Build candidate fingerprints from the user's calibrations whose `imageCalibration.reference`
 * has a precomputed pHash. Mirrors `buildCalibrationFingerprints` for the PDF flow but skips the
 * file read entirely — the fingerprint was persisted at calibration save time.
 */
export async function buildImageCalibrationCandidates(input: {
  userId: string;
}): Promise<ImageCalibrationCandidate[]> {
  const rows = await prisma.setupSheetCalibration.findMany({
    where: {
      OR: [{ userId: input.userId }, { communityShared: true }],
    },
    select: {
      id: true,
      name: true,
      calibrationDataJson: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  const out: ImageCalibrationCandidate[] = [];
  const seenName = new Set<string>();
  for (const row of rows) {
    if (seenName.has(row.name)) continue;
    const data = normalizeCalibrationData(row.calibrationDataJson);
    const ref = data.imageCalibration?.reference;
    if (!ref?.pHash64) continue;
    out.push({
      calibrationId: row.id,
      calibrationName: row.name,
      pHash64: ref.pHash64,
      headerTokens: ref.headerTokens ?? [],
    });
    seenName.add(row.name);
  }
  return out;
}

/** Combine pHash similarity (1 - hamming/64) with header-token Jaccard, weighted toward visual hash. */
function compositeScore(fp: ImageFingerprint, candidate: ImageCalibrationCandidate): number {
  const hamming = hammingDistanceHex(fp.pHash64, candidate.pHash64);
  const visual = 1 - hamming / 64;
  const tokenScore = tokenJaccard(fp.headerTokens, candidate.headerTokens);
  return 0.7 * visual + 0.3 * tokenScore;
}

export type ImagePickResult =
  | { kind: "exact"; calibrationId: string; calibrationName: string; hamming: number }
  | { kind: "ambiguous"; suggestedCalibrationId: string; suggestedCalibrationName: string; topNames: string[] }
  | { kind: "none"; closestName: string | null; closestScore: number };

export function pickImageCalibration(
  fp: ImageFingerprint,
  candidates: ImageCalibrationCandidate[]
): ImagePickResult {
  if (candidates.length === 0) return { kind: "none", closestName: null, closestScore: 0 };
  const scored = candidates
    .map((c) => ({ candidate: c, score: compositeScore(fp, c), hamming: hammingDistanceHex(fp.pHash64, c.pHash64) }))
    .sort((a, b) => b.score - a.score);
  const top = scored[0]!;
  // Hamming ≤ 4 on the visual hash plus header overlap is essentially the same image template.
  if (top.hamming <= 4 && top.score >= 0.85) {
    return {
      kind: "exact",
      calibrationId: top.candidate.calibrationId,
      calibrationName: top.candidate.calibrationName,
      hamming: top.hamming,
    };
  }
  if (top.score >= 0.7) {
    const second = scored[1];
    if (second && top.score - second.score < 0.05) {
      return {
        kind: "ambiguous",
        suggestedCalibrationId: top.candidate.calibrationId,
        suggestedCalibrationName: top.candidate.calibrationName,
        topNames: scored.slice(0, 4).map((s) => s.candidate.calibrationName),
      };
    }
    return {
      kind: "exact",
      calibrationId: top.candidate.calibrationId,
      calibrationName: top.candidate.calibrationName,
      hamming: top.hamming,
    };
  }
  return { kind: "none", closestName: top.candidate.calibrationName, closestScore: top.score };
}

/**
 * Fingerprint the image bytes and resolve a `RepickOutcome` shaped like the PDF auto-picker so
 * `quick-create/route.ts` can hand it through the same downstream code.
 */
export async function repickImageCalibrationForBytes(
  bytes: Uint8Array,
  candidates: ImageCalibrationCandidate[],
  options: { debugPrefix?: string } = {}
): Promise<RepickOutcome> {
  const prefix = options.debugPrefix ?? "imageAuto";
  if (candidates.length === 0) {
    return {
      pickedCalibrationId: null,
      pickedCalibrationName: null,
      pickSource: "none",
      pickDebug: `${prefix} no_image_candidates (no calibrations have a saved image fingerprint)`,
    };
  }
  let fp: ImageFingerprint;
  try {
    fp = await fingerprintImageBytes(bytes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      pickedCalibrationId: null,
      pickedCalibrationName: null,
      pickSource: "none",
      pickDebug: `${prefix} fingerprint_error=${msg.slice(0, 200)}`,
    };
  }
  const pick = pickImageCalibration(fp, candidates);
  if (pick.kind === "exact") {
    return {
      pickedCalibrationId: pick.calibrationId,
      pickedCalibrationName: pick.calibrationName,
      pickSource: "exact_fingerprint",
      pickDebug: `${prefix} exact=${pick.calibrationName} hamming=${pick.hamming}`,
    };
  }
  if (pick.kind === "ambiguous") {
    return {
      pickedCalibrationId: pick.suggestedCalibrationId,
      pickedCalibrationName: pick.suggestedCalibrationName,
      pickSource: "ambiguous_suggestion",
      pickDebug: `${prefix} ambiguous (${pick.topNames.join(" | ")}) suggested=${pick.suggestedCalibrationName}`,
    };
  }
  return {
    pickedCalibrationId: null,
    pickedCalibrationName: null,
    pickSource: "none",
    pickDebug: `${prefix} no_match closest=${pick.closestName ?? "none"} score=${pick.closestScore.toFixed(3)}`,
  };
}
