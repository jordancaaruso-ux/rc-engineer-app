import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getIncludedLapDashboardMetrics, primaryLapRowsFromRun } from "@/lib/lapAnalysis";
import { parseHandlingAssessmentJson } from "@/lib/runHandlingAssessment";
import { normalizeSetupData, DEFAULT_SETUP_FIELDS } from "@/lib/runSetup";
import { listSetupKeysChangedBetweenSnapshots } from "@/lib/setupCompare/listSetupKeysChangedBetweenSnapshots";
import { isTuningComparisonKey } from "@/lib/setupComparison/tuningComparisonKeys";
import { compareSetupField } from "@/lib/setupCompare/compare";
import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import { buildCatalogFromTemplate, buildFieldMetaMap } from "@/lib/setupFieldCatalog";

export type SetupOutcomePolarity = "positive" | "negative";
export type SetupOutcomeSource = "post_run_chip" | "notes_laps_only";
export type SetupOutcomeConfidence = "high" | "medium" | "low";

export type SetupOutcomeMemoryRowV1 = {
  key: string;
  label: string;
  direction: string;
  before: string;
  after: string;
  priorChange: string;
  outcome: SetupOutcomePolarity;
  outcomeSource: SetupOutcomeSource;
  suggestionEffect: "caveat_only";
  evidence: string[];
  confidence: SetupOutcomeConfidence;
  matchedBy?: "exact_key_direction";
  context: {
    sameTrack: boolean | null;
    sameEvent: boolean | null;
    sameTireSet: boolean | null;
    sameTireRunIndex: boolean | null;
    changedKeyCount: number;
  };
  runIds: { from: string; to: string };
};

export type SetupOutcomeMemoryV1 = {
  version: 1;
  generatedAtIso: string;
  userId: string;
  carId: string;
  anchorRunId: string | null;
  rows: SetupOutcomeMemoryRowV1[];
  caveatLines: string[];
  fingerprint: string;
};

export type SetupOutcomeMemoryCandidate = {
  key?: string | null;
  label?: string | null;
  before?: string | null;
  after?: string | null;
  text?: string | null;
};

export type SetupOutcomeMemoryRunInput = {
  id: string;
  sortAt: Date;
  trackId: string | null;
  eventId: string | null;
  tireSetId: string | null;
  tireRunNumber: number;
  lapTimes: unknown;
  lapSession?: unknown;
  notes: string | null;
  driverNotes: string | null;
  handlingProblems: string | null;
  handlingAssessmentJson: unknown;
  setupSnapshot: { data: unknown } | null;
};

const MAX_ROWS = 18;
const MAX_CAVEATS = 5;
const LAP_EPS_SEC = 0.02;
const fieldMap = new Map(DEFAULT_SETUP_FIELDS.map((f) => [f.key, f]));
const a800rrMap = buildFieldMetaMap(buildCatalogFromTemplate(A800RR_SETUP_SHEET_V1));

function stableReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as object)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = (value as Record<string, unknown>)[k];
        return acc;
      }, {});
  }
  return value;
}

function hashMemoryMaterial(material: unknown): string {
  return createHash("sha256").update(JSON.stringify(material, stableReplacer), "utf8").digest("hex");
}

function labelForKey(key: string): string {
  const d = fieldMap.get(key);
  if (d) return d.label + (d.unit ? ` (${d.unit})` : "");
  const m = a800rrMap.get(key);
  if (m) return m.label + (m.unit ? ` (${m.unit})` : "");
  return key.replace(/_/g, " ");
}

function parseNumber(raw: string | null | undefined): number | null {
  const t = raw?.trim();
  if (!t || t === "—" || t === "-") return null;
  const cleaned = t
    .replace(/mm|gf\/mm|cst|wt|%|°/gi, "")
    .replace(",", ".")
    .trim();
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function directionForKey(key: string, before: string, after: string): string {
  const b = parseNumber(before);
  const a = parseNumber(after);
  if (b == null || a == null || Math.abs(a - b) < 1e-4) return "changed";
  if (
    key.includes("_shim") ||
    key.includes("_shims") ||
    key.includes("ride_height") ||
    key.includes("diff_height") ||
    key.includes("under_hub")
  ) {
    return a > b ? "raised" : "lowered";
  }
  if (key.includes("spring")) return a > b ? "stiffened" : "softened";
  if (key.includes("damper_oil") || key === "diff_oil") return a > b ? "thickened" : "lightened";
  return a > b ? "increased" : "decreased";
}

function normalizeText(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function noteSentiment(notes: string): SetupOutcomePolarity | null {
  const t = normalizeText(notes);
  if (!t) return null;
  const negative = /\b(worse|bad|slower|loose|push|understeer|oversteer|hard to drive|edgy|nervous|lost|struggle|struggled)\b/.test(t);
  const positive = /\b(better|good|faster|improved|easy|easier|stable|more grip|hooked|confident)\b/.test(t);
  if (negative && !positive) return "negative";
  if (positive && !negative) return "positive";
  return null;
}

function lapEvidence(
  current: SetupOutcomeMemoryRunInput,
  previous: SetupOutcomeMemoryRunInput
): { polarity: SetupOutcomePolarity | null; lines: string[] } {
  const cur = getIncludedLapDashboardMetrics(primaryLapRowsFromRun(current));
  const prev = getIncludedLapDashboardMetrics(primaryLapRowsFromRun(previous));
  const lines: string[] = [];
  let score = 0;
  const compare = (label: string, curValue: number | null, prevValue: number | null, lowerIsBetter = true) => {
    if (curValue == null || prevValue == null) return;
    const delta = curValue - prevValue;
    if (Math.abs(delta) < LAP_EPS_SEC) return;
    const regressed = lowerIsBetter ? delta > 0 : delta < 0;
    score += regressed ? -1 : 1;
    lines.push(`${label} ${regressed ? "regressed" : "improved"} (${delta > 0 ? "+" : ""}${delta.toFixed(3)}s)`);
  };
  compare("best lap", cur.bestLap, prev.bestLap);
  if (cur.lapCount >= 5 && prev.lapCount >= 5) compare("avg top 5", cur.avgTop5, prev.avgTop5);
  if (cur.lapCount >= 10 && prev.lapCount >= 10) compare("avg top 10", cur.avgTop10, prev.avgTop10);
  if (score < 0) return { polarity: "negative", lines };
  if (score > 0) return { polarity: "positive", lines };
  return { polarity: null, lines };
}

function chipEvidence(raw: unknown): { polarity: SetupOutcomePolarity | null; line: string | null; magnitude: number } {
  const parsed = parseHandlingAssessmentJson(raw);
  const feel = parsed?.feelVsLastRun;
  if (typeof feel !== "number" || feel === 0) return { polarity: null, line: null, magnitude: 0 };
  const mag = Math.abs(feel);
  return {
    polarity: feel < 0 ? "negative" : "positive",
    line: `better/worse chip marked ${feel < 0 ? "worse" : "better"} (${feel > 0 ? "+" : ""}${feel})`,
    magnitude: mag,
  };
}

function confidenceForPair(input: {
  source: SetupOutcomeSource;
  chipMagnitude: number;
  changedKeyCount: number;
  sameTrack: boolean | null;
  sameTireSet: boolean | null;
  sameTireRunIndex: boolean | null;
}): SetupOutcomeConfidence {
  if (input.source !== "post_run_chip") return "low";
  if (input.changedKeyCount <= 2 && input.sameTrack !== false && input.sameTireSet !== false && input.chipMagnitude >= 2) {
    return "high";
  }
  if (input.changedKeyCount <= 5 && input.sameTrack !== false && input.sameTireRunIndex !== false) return "medium";
  return "low";
}

function rowMatchesCandidate(row: SetupOutcomeMemoryRowV1, candidate: SetupOutcomeMemoryCandidate): SetupOutcomeMemoryRowV1 | null {
  if (!candidate.key || candidate.key !== row.key) return null;
  const dir = candidateDirection(candidate);
  if (dir && dir !== row.direction) return null;
  return { ...row, matchedBy: "exact_key_direction" };
}

function candidateDirection(candidate: SetupOutcomeMemoryCandidate): string | null {
  if (candidate.before && candidate.after) return directionForKey(candidate.key ?? "", candidate.before, candidate.after);
  const t = normalizeText(candidate.text ?? candidate.label ?? "");
  if (/\b(lower|lowered|lowering|less|reduce|reduced)\b/.test(t)) return "lowered";
  if (/\b(raise|raised|raising|higher|more|increase|increased)\b/.test(t)) return "raised";
  if (/\b(soften|softened|softer)\b/.test(t)) return "softened";
  if (/\b(stiffen|stiffened|stiffer)\b/.test(t)) return "stiffened";
  return null;
}

function caveatLine(row: SetupOutcomeMemoryRowV1): string {
  const source =
    row.outcomeSource === "post_run_chip"
      ? `you marked this ${row.outcome === "negative" ? "worse" : "better"} after the run`
      : `notes/lap data only ${row.outcome === "negative" ? "looked worse" : "looked better"}`;
  const prefix = row.outcomeSource === "post_run_chip" ? "History caveat" : "Soft history caveat";
  return `${prefix}: ${row.label} ${row.direction} (${row.priorChange}) previously ${row.outcome === "negative" ? "had a negative result" : "had a positive result"} — ${source}. Keep the suggestion unchanged; use this as context only.`;
}

function dedupeRows(rows: SetupOutcomeMemoryRowV1[]): SetupOutcomeMemoryRowV1[] {
  const seen = new Set<string>();
  const out: SetupOutcomeMemoryRowV1[] = [];
  for (const row of rows) {
    const sig = `${row.key}:${row.direction}:${row.outcome}:${row.outcomeSource}:${row.runIds.to}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(row);
  }
  return out;
}

export function buildSetupOutcomeMemoryFromRuns(params: {
  userId: string;
  carId: string;
  anchorRunId?: string | null;
  runs: SetupOutcomeMemoryRunInput[];
  candidates?: SetupOutcomeMemoryCandidate[] | null;
  caveatKeyAllowlist?: string[] | null;
  generatedAtIso?: string;
}): SetupOutcomeMemoryV1 {
  const sorted = [...params.runs].sort((a, b) => a.sortAt.getTime() - b.sortAt.getTime());
  const rows: SetupOutcomeMemoryRowV1[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1]!;
    const current = sorted[i]!;
    const changedKeys = listSetupKeysChangedBetweenSnapshots(
      current.setupSnapshot?.data,
      previous.setupSnapshot?.data,
      { keyFilter: isTuningComparisonKey }
    );
    if (changedKeys.length === 0) continue;

    const chip = chipEvidence(current.handlingAssessmentJson);
    const notes = [current.notes, current.driverNotes, current.handlingProblems].filter(Boolean).join(" · ");
    const notesPolarity = noteSentiment(notes);
    const laps = lapEvidence(current, previous);
    const outcome = chip.polarity ?? notesPolarity ?? laps.polarity;
    if (!outcome) continue;

    const source: SetupOutcomeSource = chip.polarity ? "post_run_chip" : "notes_laps_only";
    const cur = normalizeSetupData(current.setupSnapshot?.data);
    const prev = normalizeSetupData(previous.setupSnapshot?.data);
    const sameTrack = current.trackId && previous.trackId ? current.trackId === previous.trackId : null;
    const sameEvent = current.eventId && previous.eventId ? current.eventId === previous.eventId : null;
    const sameTireSet = current.tireSetId && previous.tireSetId ? current.tireSetId === previous.tireSetId : null;
    const sameTireRunIndex = current.tireRunNumber === previous.tireRunNumber;

    for (const key of changedKeys) {
      const cmp = compareSetupField({ key, a: cur[key], b: prev[key], numericAggregationByKey: null });
      if (cmp.areEqual) continue;
      const label = labelForKey(key);
      const direction = directionForKey(key, cmp.normalizedB, cmp.normalizedA);
      const evidence = [
        chip.line,
        ...(source === "notes_laps_only" && notesPolarity ? [`notes text looked ${notesPolarity}`] : []),
        ...laps.lines.slice(0, 2),
      ].filter((line): line is string => Boolean(line));
      rows.push({
        key,
        label,
        direction,
        before: cmp.normalizedB,
        after: cmp.normalizedA,
        priorChange: `${cmp.normalizedB} -> ${cmp.normalizedA}`,
        outcome,
        outcomeSource: source,
        suggestionEffect: "caveat_only",
        evidence,
        confidence: confidenceForPair({
          source,
          chipMagnitude: chip.magnitude,
          changedKeyCount: changedKeys.length,
          sameTrack,
          sameTireSet,
          sameTireRunIndex,
        }),
        context: {
          sameTrack,
          sameEvent,
          sameTireSet,
          sameTireRunIndex,
          changedKeyCount: changedKeys.length,
        },
        runIds: { from: previous.id, to: current.id },
      });
    }
  }

  const candidateRows =
    params.candidates && params.candidates.length > 0
      ? rows.flatMap((row) => {
          for (const candidate of params.candidates ?? []) {
            const match = rowMatchesCandidate(row, candidate);
            if (match) return [match];
          }
          return [];
        })
      : rows;

  const ranked = dedupeRows(candidateRows).sort((a, b) => {
    const sourceRank = (r: SetupOutcomeMemoryRowV1) => (r.outcomeSource === "post_run_chip" ? 1 : 0);
    const outcomeRank = (r: SetupOutcomeMemoryRowV1) => (r.outcome === "negative" ? 1 : 0);
    const confRank: Record<SetupOutcomeConfidence, number> = { high: 3, medium: 2, low: 1 };
    return (
      sourceRank(b) - sourceRank(a) ||
      outcomeRank(b) - outcomeRank(a) ||
      confRank[b.confidence] - confRank[a.confidence]
    );
  });

  const limitedRows = ranked.slice(0, MAX_ROWS);
  const allow =
    params.caveatKeyAllowlist && params.caveatKeyAllowlist.length > 0 ? new Set(params.caveatKeyAllowlist) : null;
  const caveatSourceRows = allow ? limitedRows.filter((r) => allow.has(r.key)) : limitedRows;
  const caveatLines = caveatSourceRows.slice(0, MAX_CAVEATS).map(caveatLine);
  const fingerprint = hashMemoryMaterial({
    v: 2,
    carId: params.carId,
    anchorRunId: params.anchorRunId ?? null,
    caveatFilter: params.caveatKeyAllowlist ? [...params.caveatKeyAllowlist].sort() : null,
    rows: limitedRows.map((r) => ({
      k: r.key,
      d: r.direction,
      o: r.outcome,
      s: r.outcomeSource,
      e: r.evidence,
      c: r.confidence,
      from: r.runIds.from,
      to: r.runIds.to,
    })),
  });

  return {
    version: 1,
    generatedAtIso: params.generatedAtIso ?? new Date().toISOString(),
    userId: params.userId,
    carId: params.carId,
    anchorRunId: params.anchorRunId ?? null,
    rows: limitedRows,
    caveatLines,
    fingerprint,
  };
}

export async function buildSetupOutcomeMemoryForRun(params: {
  userId: string;
  anchorRunId: string | null;
  carId: string | null;
  candidates?: SetupOutcomeMemoryCandidate[] | null;
  caveatKeyAllowlist?: string[] | null;
  limit?: number;
}): Promise<SetupOutcomeMemoryV1 | null> {
  const carId =
    params.carId ??
    (params.anchorRunId
      ? (
          await prisma.run.findFirst({
            where: { id: params.anchorRunId, userId: params.userId },
            select: { carId: true },
          })
        )?.carId
      : null);
  if (!carId) return null;

  const runs = await prisma.run.findMany({
    where: {
      userId: params.userId,
      carId,
      loggingComplete: true,
    },
    orderBy: { sortAt: "desc" },
    take: Math.min(120, Math.max(8, params.limit ?? 60)),
    select: {
      id: true,
      sortAt: true,
      trackId: true,
      eventId: true,
      tireSetId: true,
      tireRunNumber: true,
      lapTimes: true,
      lapSession: true,
      notes: true,
      driverNotes: true,
      handlingProblems: true,
      handlingAssessmentJson: true,
      setupSnapshot: { select: { data: true } },
    },
  });

  if (runs.length < 2) return null;
  return buildSetupOutcomeMemoryFromRuns({
    userId: params.userId,
    carId,
    anchorRunId: params.anchorRunId,
    runs,
    candidates: params.candidates,
    caveatKeyAllowlist: params.caveatKeyAllowlist,
  });
}
