/**
 * "Known-good" / "known-bad" history mining for the Engineer.
 *
 * Uses the required car rating to surface:
 *   - Best-rated recent run(s) on the same car (and same track when possible).
 *   - Worst-rated recent run(s) on the same car.
 *   - Setup keys that have changed since the best-rated reference, so the Engineer can
 *     say "the car was rated 9/10 with X; X has since moved by Y" without inventing
 *     correlations.
 *
 * Behavior rules from the data-enhanced-engineer plan:
 *   - Do not require repeated patterns before mentioning history.
 *   - When a single similar case exists, mention it softly.
 *   - Same car + same track wins; same car other tracks is allowed with a caveat.
 */
import "server-only";

import { prisma } from "@/lib/prisma";
import { normalizeSetupData, DEFAULT_SETUP_FIELDS } from "@/lib/runSetup";
import { listSetupKeysChangedBetweenSnapshots } from "@/lib/setupCompare/listSetupKeysChangedBetweenSnapshots";
import { isTuningComparisonKey } from "@/lib/setupComparison/tuningComparisonKeys";
import { compareSetupField } from "@/lib/setupCompare/compare";
import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import { buildCatalogFromTemplate, buildFieldMetaMap } from "@/lib/setupFieldCatalog";

const DEFAULT_FIELD_LABELS = new Map(DEFAULT_SETUP_FIELDS.map((f) => [f.key, f]));
const A800RR_FIELD_LABELS = buildFieldMetaMap(buildCatalogFromTemplate(A800RR_SETUP_SHEET_V1));

const HISTORY_LOOKBACK = 80;
const KNOWN_GOOD_RATING_THRESHOLD = 8;
const KNOWN_BAD_RATING_THRESHOLD = 4;
const MAX_REFERENCES = 3;
const MAX_CHANGED_KEYS = 8;

function labelForKey(key: string): string {
  const a = DEFAULT_FIELD_LABELS.get(key);
  if (a) return a.label + (a.unit ? ` (${a.unit})` : "");
  const b = A800RR_FIELD_LABELS.get(key);
  if (b) return b.label + (b.unit ? ` (${b.unit})` : "");
  return key.replace(/_/g, " ");
}

export type KnownGoodReferenceV1 = {
  runId: string;
  rating: number;
  sortAtIso: string;
  trackId: string | null;
  trackLabel: string | null;
  sameTrack: boolean;
  /** Setup keys that changed between this reference and the current run. */
  changedSinceKeys: Array<{ key: string; label: string; previous: string; current: string }>;
  /** Plain-English line the Engineer can quote. */
  summary: string;
};

export type KnownBadReferenceV1 = {
  runId: string;
  rating: number;
  sortAtIso: string;
  trackId: string | null;
  trackLabel: string | null;
  /** Keys that changed *into* that bad run from its own prior run on this car. */
  contributingKeys: Array<{ key: string; label: string; previous: string; current: string }>;
  summary: string;
};

export type KnownGoodMemoryV1 = {
  version: 1;
  generatedAtIso: string;
  anchorRunId: string;
  carId: string;
  /** True when the anchor's track was used to filter known-good search. */
  sameTrackPreferred: boolean;
  ratingTrend: "improving" | "stable" | "declining" | "insufficient_data";
  bestReferences: KnownGoodReferenceV1[];
  worstReferences: KnownBadReferenceV1[];
  /** Caveat lines for LLM prompts. */
  caveatLines: string[];
};

type HistoryRow = {
  id: string;
  sortAt: Date;
  carRating: number | null;
  trackId: string | null;
  track: { name: string } | null;
  setupSnapshot: { id: string; data: unknown } | null;
};

function describeTrendFromRatings(values: number[]): KnownGoodMemoryV1["ratingTrend"] {
  if (values.length < 3) return "insufficient_data";
  const first = values[0]!;
  const last = values[values.length - 1]!;
  if (Math.abs(last - first) <= 1) return "stable";
  return last > first ? "improving" : "declining";
}

function buildChangedKeys(
  currentData: unknown,
  pastData: unknown
): Array<{ key: string; label: string; previous: string; current: string }> {
  const keys = listSetupKeysChangedBetweenSnapshots(currentData, pastData, {
    keyFilter: isTuningComparisonKey,
  });
  if (keys.length === 0) return [];
  const cur = normalizeSetupData(currentData);
  const prev = normalizeSetupData(pastData);
  const rows: Array<{ key: string; label: string; previous: string; current: string }> = [];
  for (const key of keys.slice(0, MAX_CHANGED_KEYS)) {
    const cmp = compareSetupField({ key, a: cur[key], b: prev[key], numericAggregationByKey: null });
    if (cmp.areEqual) continue;
    rows.push({
      key,
      label: labelForKey(key),
      previous: cmp.normalizedB,
      current: cmp.normalizedA,
    });
  }
  return rows;
}

function rateToKnownGoodSummary(row: HistoryRow, sameTrack: boolean, changes: number): string {
  const where = sameTrack ? "this track" : "a different track";
  const lookback = `at ${where} on ${row.sortAt.toISOString().slice(0, 10)}`;
  if (changes === 0) return `Car was rated ${row.carRating}/10 ${lookback}; current setup matches that reference exactly.`;
  return `Car was rated ${row.carRating}/10 ${lookback}; ${changes} chassis key${changes === 1 ? " has" : "s have"} moved since.`;
}

function rateToKnownBadSummary(row: HistoryRow, changes: number): string {
  const lookback = row.sortAt.toISOString().slice(0, 10);
  if (changes === 0) return `Car was rated ${row.carRating}/10 on ${lookback}; setup looked similar to the prior run (no chassis changes).`;
  return `Car was rated ${row.carRating}/10 on ${lookback}; ${changes} chassis key${changes === 1 ? "" : "s"} had changed vs the prior run.`;
}

export async function buildKnownGoodMemoryV1(params: {
  userId: string;
  carId: string;
  anchorRunId: string;
}): Promise<KnownGoodMemoryV1 | null> {
  const anchor = await prisma.run.findFirst({
    where: { id: params.anchorRunId, userId: params.userId, carId: params.carId },
    select: {
      id: true,
      sortAt: true,
      trackId: true,
      setupSnapshot: { select: { id: true, data: true } },
    },
  });
  if (!anchor || !anchor.setupSnapshot) return null;

  const history = (await prisma.run.findMany({
    where: {
      userId: params.userId,
      carId: params.carId,
      loggingComplete: true,
      carRating: { not: null },
      id: { not: anchor.id },
      sortAt: { lt: anchor.sortAt },
    },
    orderBy: { sortAt: "desc" },
    take: HISTORY_LOOKBACK,
    select: {
      id: true,
      sortAt: true,
      carRating: true,
      trackId: true,
      track: { select: { name: true } },
      setupSnapshot: { select: { id: true, data: true } },
    },
  })) as HistoryRow[];

  if (history.length === 0) return null;

  const sameTrackHistory = anchor.trackId
    ? history.filter((row) => row.trackId === anchor.trackId)
    : [];
  const sameTrackPreferred = sameTrackHistory.length >= 1;

  const goodPool = sameTrackPreferred ? sameTrackHistory : history;
  const goodCandidates = [...goodPool]
    .filter((r) => typeof r.carRating === "number" && r.carRating! >= KNOWN_GOOD_RATING_THRESHOLD)
    .sort((a, b) => (b.carRating ?? 0) - (a.carRating ?? 0) || b.sortAt.getTime() - a.sortAt.getTime())
    .slice(0, MAX_REFERENCES);

  const bestReferences: KnownGoodReferenceV1[] = goodCandidates.map((row) => {
    const sameTrack = anchor.trackId != null && row.trackId === anchor.trackId;
    const changes = buildChangedKeys(anchor.setupSnapshot?.data ?? null, row.setupSnapshot?.data ?? null);
    return {
      runId: row.id,
      rating: row.carRating!,
      sortAtIso: row.sortAt.toISOString(),
      trackId: row.trackId,
      trackLabel: row.track?.name ?? null,
      sameTrack,
      changedSinceKeys: changes,
      summary: rateToKnownGoodSummary(row, sameTrack, changes.length),
    };
  });

  const badCandidates = [...history]
    .filter((r) => typeof r.carRating === "number" && r.carRating! <= KNOWN_BAD_RATING_THRESHOLD)
    .sort((a, b) => (a.carRating ?? 0) - (b.carRating ?? 0) || b.sortAt.getTime() - a.sortAt.getTime())
    .slice(0, MAX_REFERENCES);

  // For each bad reference, compute the changes that moved into it vs its own previous run.
  const worstReferences: KnownBadReferenceV1[] = [];
  for (const row of badCandidates) {
    const priorOfBad = await prisma.run.findFirst({
      where: {
        userId: params.userId,
        carId: params.carId,
        id: { not: row.id },
        sortAt: { lt: row.sortAt },
        loggingComplete: true,
      },
      orderBy: { sortAt: "desc" },
      select: { id: true, setupSnapshot: { select: { data: true } } },
    });
    const contributingKeys = priorOfBad
      ? buildChangedKeys(row.setupSnapshot?.data ?? null, priorOfBad.setupSnapshot?.data ?? null)
      : [];
    worstReferences.push({
      runId: row.id,
      rating: row.carRating!,
      sortAtIso: row.sortAt.toISOString(),
      trackId: row.trackId,
      trackLabel: row.track?.name ?? null,
      contributingKeys,
      summary: rateToKnownBadSummary(row, contributingKeys.length),
    });
  }

  const ratingValues = [...history]
    .filter((r) => typeof r.carRating === "number")
    .map((r) => r.carRating!)
    .slice(0, 6)
    .reverse(); // oldest -> newest
  const ratingTrend = describeTrendFromRatings(ratingValues);

  const caveatLines: string[] = [];
  for (const ref of bestReferences) {
    if (ref.changedSinceKeys.length === 0) continue;
    const sample = ref.changedSinceKeys.slice(0, 3).map((k) => k.label).join(", ");
    caveatLines.push(
      `Known-good caveat: car was rated ${ref.rating}/10 on ${ref.sortAtIso.slice(0, 10)}${ref.sameTrack ? " (same track)" : " (different track)"}; chassis keys that have moved since: ${sample}${ref.changedSinceKeys.length > 3 ? ", …" : ""}.`
    );
  }
  for (const ref of worstReferences) {
    if (ref.contributingKeys.length === 0) continue;
    const sample = ref.contributingKeys.slice(0, 3).map((k) => k.label).join(", ");
    caveatLines.push(
      `Known-bad caveat: rated ${ref.rating}/10 on ${ref.sortAtIso.slice(0, 10)} after these chassis changes: ${sample}${ref.contributingKeys.length > 3 ? ", …" : ""}. Watch for repeating the same direction.`
    );
  }

  if (bestReferences.length === 0 && worstReferences.length === 0) return null;

  return {
    version: 1,
    generatedAtIso: new Date().toISOString(),
    anchorRunId: anchor.id,
    carId: params.carId,
    sameTrackPreferred,
    ratingTrend,
    bestReferences,
    worstReferences,
    caveatLines: caveatLines.slice(0, 6),
  };
}
