import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import { getEffectiveRunNotes } from "@/lib/engineerPhase5/mergeRunNotes";

const SNIPPET_MAX = 120;

function pacePhrase(summary: EngineerRunSummaryV2): string {
  const b = summary.lapOutcome.best;
  const a5 = summary.lapOutcome.avgTop5;
  const parts: string[] = [];
  if (!summary.referenceRunId) {
    return "There is no earlier run on this car to compare against.";
  }
  if (b.flag === "improved") parts.push("best lap improved");
  else if (b.flag === "regressed") parts.push("best lap was slower");
  else if (b.flag === "flat") parts.push("best lap was effectively unchanged");
  if (a5.flag === "improved") parts.push("average of the fastest five laps improved");
  else if (a5.flag === "regressed") parts.push("average of the fastest five laps was slower");
  else if (a5.flag === "flat") parts.push("average of the fastest five laps was effectively unchanged");
  if (parts.length === 0) return "Pace vs the reference run is mixed or not fully available.";
  return `Compared to the reference run: ${parts.join("; ")}.`;
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
  run: { notes?: string | null; driverNotes?: string | null; handlingProblems?: string | null }
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
  run: { notes?: string | null; driverNotes?: string | null; handlingProblems?: string | null }
): string {
  const text = getEffectiveRunNotes(run).toLowerCase();
  if (!text.includes("faster") && !text.includes("better") && !text.includes("improved")) return "";
  const b = summary.lapOutcome.best;
  const a5 = summary.lapOutcome.avgTop5;
  if (b.flag === "regressed" || a5.flag === "regressed") {
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
  const chunks = [pacePhrase(summary), setupPhrase(summary), notesPhrase(summary, run), conflictPhrase(summary, run)].filter(
    Boolean
  );
  const soft = summary.softPriors.length
    ? `Historical context: ${summary.softPriors.join(" ")}`
    : "";
  if (soft) chunks.push(soft);
  return chunks.join(" ");
}
