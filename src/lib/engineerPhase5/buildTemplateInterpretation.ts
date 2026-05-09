import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import { getEffectiveRunNotes } from "@/lib/engineerPhase5/mergeRunNotes";

const SNIPPET_MAX = 120;

function pacePhrase(summary: EngineerRunSummaryV2): string {
  const b = summary.lapOutcome.best;
  const a5 = summary.lapOutcome.avgTop5;
  const a10 = summary.lapOutcome.avgTop10;
  const parts: string[] = [];
  if (!summary.referenceRunId) {
    return "There is no earlier run on this car to compare against.";
  }
  if (a10.flag === "improved") parts.push("average of the fastest ten laps improved");
  else if (a10.flag === "regressed") parts.push("average of the fastest ten laps was slower");
  else if (a10.flag === "flat") parts.push("average of the fastest ten laps was effectively unchanged");
  if (a5.flag === "improved") parts.push("average of the fastest five laps improved");
  else if (a5.flag === "regressed") parts.push("average of the fastest five laps was slower");
  else if (a5.flag === "flat") parts.push("average of the fastest five laps was effectively unchanged");
  if (b.flag === "improved") parts.push("best lap improved");
  else if (b.flag === "regressed") parts.push("best lap was slower");
  else if (b.flag === "flat") parts.push("best lap was effectively unchanged");
  if (parts.length === 0) return "Pace vs the reference run is mixed or not fully available.";
  let out = `Compared to the reference run: ${parts.join("; ")}.`;
  const fs = summary.importedSessionFieldStats;
  const mean10 = fs?.paceVsFieldMeanAnalysis?.find((m) => m.metric === "avg_top_10");
  if (
    fs &&
    fs.driverCount >= 2 &&
    mean10 &&
    mean10.gapUserMinusFieldMeanSeconds != null &&
    Number.isFinite(mean10.gapUserMinusFieldMeanSeconds)
  ) {
    const g = mean10.gapUserMinusFieldMeanSeconds;
    const sign = g >= 0 ? "+" : "";
    const rk =
      mean10.rankInField != null && mean10.fieldEntrantCountForMetric >= 2
        ? ` rank ${mean10.rankInField} of ${mean10.fieldEntrantCountForMetric} in this session on avg top 10.`
        : "";
    out += ` Imported session field: avg top 10 is ${sign}${Math.abs(g).toFixed(3)}s ${
      g <= 0 ? "faster" : "slower"
    } than the session field average;${rk}`;
  }
  return out;
}

function importedSessionFieldPhrase(summary: EngineerRunSummaryV2): string {
  const s = summary.importedSessionFieldStats;
  if (!s || s.driverCount < 2) return "";
  const y = s.matchedYou;
  const parts: string[] = [];
  if (y) {
    const analysis = s.paceVsFieldMeanAnalysis;
    const a10 = analysis?.find((m) => m.metric === "avg_top_10");
    if (a10) {
      const mean10 =
        a10.fieldMeanSeconds != null && Number.isFinite(a10.fieldMeanSeconds)
          ? a10.fieldMeanSeconds.toFixed(3)
          : "—";
      const you10 =
        a10.userSeconds != null && Number.isFinite(a10.userSeconds) ? a10.userSeconds.toFixed(3) : "—";
      const gapS =
        a10.gapUserMinusFieldMeanSeconds != null && Number.isFinite(a10.gapUserMinusFieldMeanSeconds)
          ? `${a10.gapUserMinusFieldMeanSeconds >= 0 ? "+" : ""}${a10.gapUserMinusFieldMeanSeconds.toFixed(3)}s vs field avg`
          : null;
      const rk10 =
        a10.rankInField != null && a10.fieldEntrantCountForMetric >= 2
          ? `rank ${a10.rankInField}/${a10.fieldEntrantCountForMetric} on avg top 10`
          : null;
      const bits = [`you ${you10}s vs field avg ${mean10}s`, gapS, rk10].filter(Boolean);
      parts.push(`primary sustained pace (avg top 10 vs session mean): ${bits.join("; ")}`);
    }
    if (y.avgTop10Seconds != null && s.fieldMedianAvgTop10Seconds != null && Number.isFinite(s.fieldMedianAvgTop10Seconds)) {
      const gapMed = y.avgTop10Seconds - s.fieldMedianAvgTop10Seconds;
      parts.push(
        `vs median competitor avg top 10: ${gapMed >= 0 ? "+" : ""}${gapMed.toFixed(3)}s (you minus field median)`
      );
    }
    if (analysis && analysis.length > 0) {
      for (const row of analysis) {
        if (row.metric === "avg_top_10") continue;
        if (!row.meaningful && row.userSeconds == null) continue;
        const gap =
          row.gapUserMinusFieldMeanSeconds != null && Number.isFinite(row.gapUserMinusFieldMeanSeconds)
            ? `${row.gapUserMinusFieldMeanSeconds >= 0 ? "+" : ""}${row.gapUserMinusFieldMeanSeconds.toFixed(3)}s vs field avg`
            : null;
        const rk =
          row.rankInField != null && row.fieldEntrantCountForMetric >= 2
            ? `rank ${row.rankInField}/${row.fieldEntrantCountForMetric} on ${row.label}`
            : null;
        const bits = [gap, rk].filter(Boolean);
        if (bits.length) parts.push(`${row.label}: ${bits.join("; ")}`);
      }
    }
    if (y.rankByBest != null) parts.push(`single-lap rank by best ${y.rankByBest} of ${s.driverCount}`);
    const gBest =
      y.gapBestToSessionBestSeconds != null && Number.isFinite(y.gapBestToSessionBestSeconds)
        ? `${y.gapBestToSessionBestSeconds.toFixed(3)}s vs session best lap (pole)`
        : null;
    const g5 =
      y.gapAvgTop5ToSessionBestAvg5Seconds != null &&
      Number.isFinite(y.gapAvgTop5ToSessionBestAvg5Seconds)
        ? `${y.gapAvgTop5ToSessionBestAvg5Seconds.toFixed(3)}s vs fastest avg-top-5 in session`
        : null;
    const g10 =
      y.gapAvgTop10ToSessionBestAvg10Seconds != null &&
      Number.isFinite(y.gapAvgTop10ToSessionBestAvg10Seconds)
        ? `${y.gapAvgTop10ToSessionBestAvg10Seconds.toFixed(3)}s vs fastest avg-top-10 in session`
        : null;
    if (!analysis?.length) {
      if (gBest) parts.push(`best lap gap ${gBest}`);
      if (g5) parts.push(`avg top-5 gap ${g5}`);
      if (g10) parts.push(`avg top-10 gap ${g10}`);
    } else {
      if (gBest) parts.push(`pole gap (optional): ${gBest}`);
    }
  } else {
    parts.push(`field has ${s.driverCount} drivers; your row was not matched to a primary imported driver name`);
  }
  if (s.fieldMedianBestSeconds != null && Number.isFinite(s.fieldMedianBestSeconds)) {
    parts.push(`field median best lap ${s.fieldMedianBestSeconds.toFixed(3)}s`);
  }
  return `Imported timing session (aggregated field): ${parts.join("; ")}.`;
}

export function fieldPhrase(summary: EngineerRunSummaryV2): string {
  const f = summary.fieldImportSession;
  const fromSets =
    f && f.ranked.length >= 2
      ? (() => {
          const you = f.ranked.find((r) => r.isPrimaryUser) ?? f.ranked[0];
          if (!you) return "";
          const gap =
            you.gapToSessionBestSeconds != null && Number.isFinite(you.gapToSessionBestSeconds)
              ? `${you.gapToSessionBestSeconds.toFixed(3)}s`
              : "—";
          const fade =
            you.fadeSeconds != null && Number.isFinite(you.fadeSeconds)
              ? `${you.fadeSeconds >= 0 ? "+" : ""}${you.fadeSeconds.toFixed(3)}s`
              : "n/a";
          return `Imported lap-set field (≥2 persisted drivers, best lap + stint fade): your row ranked ${you.rank} of ${f.ranked.length}; gap to session best lap ${gap}; stint fade ${fade} (second half vs first half of included laps, when computable).`;
        })()
      : "";
  const agg = importedSessionFieldPhrase(summary);
  return [fromSets, agg].filter(Boolean).join(" ");
}

function setupPhrase(summary: EngineerRunSummaryV2): string {
  const n = summary.setupChanges.length;
  if (!summary.referenceRunId) return "";
  if (n === 0) return "Setup fields match the reference run on record.";
  const top = summary.setupChanges[0];
  if (!top) return `Setup differs in ${n} field(s).`;
  return `Setup differs in ${n} field(s); largest recorded change: ${top.label} (${top.before} → ${top.after}).`;
}

function notesPhrase(
  summary: EngineerRunSummaryV2,
  run: {
    notes?: string | null;
    driverNotes?: string | null;
    handlingProblems?: string | null;
    handlingAssessmentJson?: unknown;
  }
): string {
  if (summary.notesUsed.role === "none") return "";
  const full = getEffectiveRunNotes(run);
  if (!full.trim()) return "";
  const vague = full.trim().length < 4 || /^bad|ok|meh|ugh\.?$/i.test(full.trim());
  if (vague) return "You left a short note; it is included only as context and does not change the metrics.";
  const snippet = summary.notesUsed.verbatimSnippet ?? full.slice(0, SNIPPET_MAX);
  return `Your notes mention: “${snippet}”. This may be consistent with what the metrics show, but other factors (track, traffic, tires) are not ruled out.`;
}

function conflictPhrase(
  summary: EngineerRunSummaryV2,
  run: {
    notes?: string | null;
    driverNotes?: string | null;
    handlingProblems?: string | null;
    handlingAssessmentJson?: unknown;
  }
): string {
  const text = getEffectiveRunNotes(run).toLowerCase();
  if (!text.includes("faster") && !text.includes("better") && !text.includes("improved")) return "";
  const b = summary.lapOutcome.best;
  const a10 = summary.lapOutcome.avgTop10;
  if (b.flag === "regressed" || a10.flag === "regressed") {
    return "Notes sound positive, but measured pace vs the reference run did not improve overall—treat lap metrics as primary.";
  }
  return "";
}

/**
 * Objective, template-only interpretation (no advice, no suggestions).
 */
export function buildTemplateInterpretation(
  summary: EngineerRunSummaryV2,
  run: { notes?: string | null; driverNotes?: string | null; handlingProblems?: string | null }
): string {
  const field = fieldPhrase(summary);
  const pace = pacePhrase(summary);
  const setup = setupPhrase(summary);
  const mid = field.trim() ? [field, setup] : [setup];
  const chunks = [
    pace,
    ...mid.filter(Boolean),
    notesPhrase(summary, run),
    conflictPhrase(summary, run),
  ].filter(Boolean);
  const soft = summary.softPriors.length
    ? `Historical context: ${summary.softPriors.join(" ")}`
    : "";
  if (soft) chunks.push(soft);
  return chunks.join(" ");
}
