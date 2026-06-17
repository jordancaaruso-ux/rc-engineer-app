import "server-only";

import { prisma } from "@/lib/prisma";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import {
  getIncludedLapDashboardMetrics,
  primaryLapRowsFromRun,
} from "@/lib/lapAnalysis";
import { matchTracksForEngineerQuery } from "@/lib/engineerPhase5/matchTrackForEngineer";
import { buildConditionalSetupEmpiricalV1 } from "@/lib/engineerPhase5/conditionalSetupForEngineer";
import { buildSetupSpreadForEngineer } from "@/lib/engineerPhase5/setupSpreadForEngineer";
import { encodeTrackConditionSignature } from "@/lib/trackConditionSignature";
import { listSetupKeysChangedBetweenSnapshots } from "@/lib/setupCompare/listSetupKeysChangedBetweenSnapshots";
import { compareSetupField } from "@/lib/setupCompare/compare";
import { isTuningComparisonKey } from "@/lib/setupComparison/tuningComparisonKeys";
import { normalizeSetupData } from "@/lib/runSetup";
import { parseTireComparisonQuery } from "@/lib/engineerPhase5/reasoningSpine/parseComparisonQuery";
import { parsePlanningQuery } from "@/lib/engineerPhase5/reasoningSpine/parsePlanningQuery";
import { compareTiresTool } from "@/lib/engineerPhase5/reasoningSpine/spineTools";

function tireHaystack(run: {
  tireSet: {
    label: string | null;
    tireType: { displayName: string; modelCode: string } | null;
  } | null;
}): string {
  return [
    run.tireSet?.tireType?.displayName,
    run.tireSet?.tireType?.modelCode,
    run.tireSet?.label,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function formatSec(s: number | null): string {
  return s == null ? "—" : `${s.toFixed(3)}s`;
}

export type DeterministicRouteAnswer = { reply: string; source: "comparison" | "planning" };

export async function tryAnswerComparisonQuery(input: {
  userId: string;
  message: string;
  timeZone: string;
}): Promise<DeterministicRouteAnswer | null> {
  const intent = parseTireComparisonQuery(input.message);
  if (!intent) return null;

  const result = await compareTiresTool(input.userId, {
    tire_label_a: intent.tireA,
    tire_label_b: intent.tireB,
    track_query: intent.trackQuery,
    time_zone: input.timeZone,
  });

  if (!result.ok) {
    return { reply: result.error, source: "comparison" };
  }

  const trackNote = result.trackName ? ` at **${result.trackName}**` : "";
  const lines: string[] = [
    `**Tire comparison${trackNote}** (from your run log — pace only; correlation not proof):`,
    "",
  ];

  for (const row of result.rows) {
    lines.push(
      `- **${row.tireLabel}** — ${row.runCount} run(s), best ${formatSec(row.bestLapSeconds)}, avg top 10 ${formatSec(row.avgTop10Seconds)}` +
        (row.latestWhenLabel ? ` (latest ${row.latestWhenLabel})` : "")
    );
  }

  if (result.rows.length >= 2) {
    const a = result.rows.find((r) =>
      tireHaystack({ tireSet: { label: r.tireLabel, tireType: null } }).includes(intent.tireA.toLowerCase())
    );
    const b = result.rows.find((r) =>
      tireHaystack({ tireSet: { label: r.tireLabel, tireType: null } }).includes(intent.tireB.toLowerCase())
    );
    if (a?.bestLapSeconds != null && b?.bestLapSeconds != null) {
      const delta = a.bestLapSeconds - b.bestLapSeconds;
      const faster = delta < 0 ? intent.tireA : intent.tireB;
      lines.push(
        "",
        `Best-lap delta: **${Math.abs(delta).toFixed(3)}s** (${faster} faster on best lap in this sample). Setup differences aren't summarized here — open those runs in Compare or ask for a focused setup diff.`
      );
    }
  }

  lines.push("", "_Use compare_tires / apply_engineer_focus for deeper setup+pace analysis._");
  return { reply: lines.join("\n"), source: "comparison" };
}

export async function tryAnswerPlanningQuery(input: {
  userId: string;
  message: string;
  timeZone: string;
  carId?: string | null;
}): Promise<DeterministicRouteAnswer | null> {
  const intent = parsePlanningQuery(input.message);
  if (!intent) return null;

  const tz = input.timeZone.trim() || "UTC";
  let trackIds: string[] | null = null;
  let trackName = "your recent tracks";
  let trackForConditional: {
    id: string;
    gripTags: string[];
    layoutTags: string[];
  } | null = null;

  if (intent.trackQuery) {
    const matches = await matchTracksForEngineerQuery(input.userId, intent.trackQuery);
    if (matches.length === 0) {
      return {
        reply: `I couldn't find a track matching "${intent.trackQuery}" for meeting prep. Try the exact track name or LiveRC slug.`,
        source: "planning",
      };
    }
    trackIds = matches.slice(0, 3).map((m) => m.id);
    trackName = matches[0]!.name;
    const trackRow = await prisma.track.findFirst({
      where: { id: matches[0]!.id },
      select: { id: true, gripTags: true, layoutTags: true },
    });
    trackForConditional = trackRow;
  }

  const runs = await prisma.run.findMany({
    where: {
      userId: input.userId,
      ...(input.carId ? { carId: input.carId } : {}),
      ...(trackIds ? { trackId: { in: trackIds } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: {
      id: true,
      createdAt: true,
      sessionCompletedAt: true,
      loggingCompletedAt: true,
      carRating: true,
      lapTimes: true,
      lapSession: true,
      sessionLabel: true,
      sessionType: true,
      meetingSessionType: true,
      meetingSessionCode: true,
      carId: true,
      tireRunNumber: true,
      setupSnapshot: { select: { data: true } },
      car: { select: { name: true } },
      track: { select: { name: true, gripTags: true, layoutTags: true } },
      tireSet: {
        select: {
          label: true,
          tireType: { select: { displayName: true } },
        },
      },
    },
  });

  if (runs.length === 0) {
    return {
      reply: intent.trackQuery
        ? `No logged runs at **${trackName}** yet — log a practice session before the meeting so I can summarize trends.`
        : "No recent runs on file for planning — log a session first.",
      source: "planning",
    };
  }

  const lines: string[] = [
    `**Meeting prep — ${trackName}**`,
    "",
    "Recent sessions (newest first):",
  ];

  for (const run of runs.slice(0, 6)) {
    const when = formatRunCreatedAtDateTime(resolveRunDisplayInstant(run), tz);
    const session = formatRunSessionDisplay(run);
    const dash = getIncludedLapDashboardMetrics(primaryLapRowsFromRun(run));
    const tire = run.tireSet?.label ?? run.tireSet?.tireType?.displayName ?? "—";
    lines.push(
      `- ${when} — ${session}, ${run.car?.name ?? "car"}, tire **${tire}** (run ${run.tireRunNumber ?? "?"}), best **${formatSec(dash.bestLap)}**, rating ${run.carRating ?? "—"}`
    );
  }

  const newest = runs[0]!;
  const prior = runs[1];
  if (prior && newest.setupSnapshot?.data && prior.setupSnapshot?.data) {
    const prevData = normalizeSetupData(prior.setupSnapshot.data);
    const curData = normalizeSetupData(newest.setupSnapshot.data);
    const changedKeys = listSetupKeysChangedBetweenSnapshots(curData, prevData, {
      keyFilter: isTuningComparisonKey,
    });
    if (changedKeys.length > 0) {
      lines.push("", "**Chassis changes since your prior session here:**");
      for (const key of changedKeys.slice(0, 8)) {
        const cmp = compareSetupField({ key, a: curData[key], b: prevData[key], numericAggregationByKey: null });
        lines.push(`- ${key}: ${cmp.normalizedB} → ${cmp.normalizedA}`);
      }
      if (changedKeys.length > 8) lines.push(`- …and ${changedKeys.length - 8} more keys`);
    }
  }

  if (intent.wantsSetupConsiderations && newest.carId) {
    const track = trackForConditional ?? newest.track;
    if (track) {
      const spread = await buildSetupSpreadForEngineer({
        userId: input.userId,
        carId: newest.carId,
        setupSnapshotData: newest.setupSnapshot?.data ?? null,
      });
      const sig = encodeTrackConditionSignature(track.gripTags ?? [], track.layoutTags ?? []);
      const empirical = await buildConditionalSetupEmpiricalV1({
        userId: input.userId,
        carId: newest.carId,
        conditionSignature: sig,
        spreadRows: spread.rows,
      });
      const top = empirical?.hasEnoughData ? empirical.rows.slice(0, 5) : [];
      if (top.length > 0) {
        lines.push("", "**Your garage at this track condition** (median vs your overall — not community):");
        for (const row of top) {
          lines.push(
            `- ${row.parameterKey}: condition ${row.conditionMedian.toFixed(2)} vs overall ${row.overallMedian.toFixed(2)} (n=${row.conditionSampleCount})`
          );
        }
      }
    }
  }

  lines.push(
    "",
    "**Suggested approach:** one clear complaint per test session; verify tire run index before blaming setup. Ask a setup-specific question with a focused run for lever-level advice."
  );

  return { reply: lines.join("\n"), source: "planning" };
}
