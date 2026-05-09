"use client";

import { cn } from "@/lib/utils";
import type { EngineerRunSummaryV2, PaceVsFieldMetricId } from "@/lib/engineerPhase5/engineerRunSummaryTypes";

function fmtSec(v: number | null | undefined, notMeaningful?: boolean): string {
  if (notMeaningful) return "—";
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(3);
}

function fmtDeltaSec(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(3)}s`;
}

function finiteGap(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return v;
}

function gapFromPaceVsFieldMean(summary: EngineerRunSummaryV2, metric: PaceVsFieldMetricId): number | null {
  const rows = summary.importedSessionFieldStats?.paceVsFieldMeanAnalysis;
  const row = rows?.find((m) => m.metric === metric);
  return finiteGap(row?.gapUserMinusFieldMeanSeconds);
}

/**
 * Multi-driver imported timing: **Vs field** prefers session **field mean** per metric when aggregates exist
 * (positive ⇒ slower than session average). Falls back to gaps vs session-best competitor when only lap-set rows exist.
 */
export function fieldRelativityForSummary(summary: EngineerRunSummaryV2): {
  multiDriverField: boolean;
  showVsFieldColumn: boolean;
  /** Lap-table gaps come from paceVsFieldMeanAnalysis (field mean), not pole/session-best. */
  vsFieldUsesSessionMeans: boolean;
  gapBest: number | null;
  gapAvg5: number | null;
  gapAvg10: number | null;
  gapAvg15: number | null;
  rank: number | null;
  nDrivers: number | null;
} {
  const fs = summary.importedSessionFieldStats;
  const ranked = summary.fieldImportSession?.ranked ?? [];
  const youRow = ranked.find((r) => r.isPrimaryUser) ?? null;
  const multiFromStats = fs != null && fs.driverCount >= 2;
  const multiFromSets = ranked.length >= 2;
  const multiDriverField = multiFromStats || multiFromSets;

  if (!multiDriverField) {
    return {
      multiDriverField: false,
      showVsFieldColumn: false,
      vsFieldUsesSessionMeans: false,
      gapBest: null,
      gapAvg5: null,
      gapAvg10: null,
      gapAvg15: null,
      rank: null,
      nDrivers: null,
    };
  }

  const meanRows = fs?.paceVsFieldMeanAnalysis;
  const useMeans = Boolean(meanRows?.length);
  const my = fs?.matchedYou;

  let gapBest: number | null = null;
  let gapAvg5: number | null = null;
  let gapAvg10: number | null = null;
  let gapAvg15: number | null = null;

  if (useMeans) {
    gapBest = gapFromPaceVsFieldMean(summary, "best");
    gapAvg5 = gapFromPaceVsFieldMean(summary, "avg_top_5");
    gapAvg10 = gapFromPaceVsFieldMean(summary, "avg_top_10");
    gapAvg15 = gapFromPaceVsFieldMean(summary, "avg_top_15");
  } else {
    gapBest = finiteGap(my?.gapBestToSessionBestSeconds ?? youRow?.gapToSessionBestSeconds);
    gapAvg5 = finiteGap(my?.gapAvgTop5ToSessionBestAvg5Seconds);
    gapAvg10 = finiteGap(my?.gapAvgTop10ToSessionBestAvg10Seconds);
    gapAvg15 = null;
  }

  const avg10RankRow = meanRows?.find((m) => m.metric === "avg_top_10");
  const rank =
    avg10RankRow?.rankInField != null && avg10RankRow.fieldEntrantCountForMetric >= 2
      ? avg10RankRow.rankInField
      : my?.rankByBest ?? youRow?.rank ?? null;
  const nDrivers =
    avg10RankRow?.fieldEntrantCountForMetric != null && avg10RankRow.fieldEntrantCountForMetric >= 2
      ? avg10RankRow.fieldEntrantCountForMetric
      : fs && fs.driverCount >= 2
        ? fs.driverCount
        : ranked.length >= 2
          ? ranked.length
          : null;

  const hasActionableGap =
    gapBest != null || gapAvg5 != null || gapAvg10 != null || gapAvg15 != null;

  return {
    multiDriverField: true,
    showVsFieldColumn: hasActionableGap,
    vsFieldUsesSessionMeans: useMeans,
    gapBest,
    gapAvg5,
    gapAvg10,
    gapAvg15,
    rank,
    nDrivers,
  };
}

function PaceVsFieldHero({
  summary,
  fieldRel,
}: {
  summary: EngineerRunSummaryV2;
  fieldRel: ReturnType<typeof fieldRelativityForSummary>;
}) {
  const fs = summary.importedSessionFieldStats;
  const f = summary.fieldImportSession;
  const ranked = f?.ranked ?? [];

  if (fieldRel.multiDriverField) {
    if (fs && fs.driverCount >= 2) {
      const my = fs.matchedYou;
      const avg10 = fs.paceVsFieldMeanAnalysis?.find((m) => m.metric === "avg_top_10");
      const medGap =
        my?.avgTop10Seconds != null &&
        fs.fieldMedianAvgTop10Seconds != null &&
        Number.isFinite(my.avgTop10Seconds) &&
        Number.isFinite(fs.fieldMedianAvgTop10Seconds)
          ? my.avgTop10Seconds - fs.fieldMedianAvgTop10Seconds
          : null;
      const rankSustained =
        fieldRel.rank != null && fieldRel.nDrivers != null && fieldRel.nDrivers >= 2
          ? `${fieldRel.rank} of ${fieldRel.nDrivers} on avg top 10`
          : null;

      return (
        <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5 space-y-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Pace vs field</div>
          {my ? (
            <div className="space-y-2 text-[12px] leading-snug">
              {avg10 ? (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-medium text-muted-foreground">Sustained pace</div>
                  {avg10.meaningful && avg10.gapUserMinusFieldMeanSeconds != null ? (
                    <>
                      <div className="text-base font-semibold text-foreground tabular-nums font-mono leading-tight">
                        {fmtDeltaSec(avg10.gapUserMinusFieldMeanSeconds)}
                      </div>
                      <div className="text-[11px] font-medium text-foreground/90">
                        Avg top 10 vs session field average
                        {rankSustained ? (
                          <span className="block mt-0.5 text-[11px] font-mono tabular-nums text-muted-foreground font-normal">
                            {rankSustained}
                          </span>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      Avg top 10 vs field average needs ≥10 included laps on your row for a stable read (same rule as lap
                      metrics).
                    </p>
                  )}
                  <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-foreground/90 pt-0.5">
                    <span className="text-muted-foreground font-sans">Field average (mean)</span>
                    <span>{fmtSec(avg10.fieldMeanSeconds)}</span>
                    <span className="text-muted-foreground font-sans">You</span>
                    <span>{fmtSec(avg10.userSeconds)}</span>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Linked timing session did not publish avg top 10 field averages for this import.
                </p>
              )}

              {medGap != null ? (
                <div className="border-t border-border/50 pt-2 space-y-0.5">
                  <div className="text-[10px] font-medium text-muted-foreground">Typical competitor</div>
                  <div className="font-mono text-[11px] tabular-nums text-foreground/90">
                    {fmtDeltaSec(medGap)}
                    <span className="text-muted-foreground font-sans text-[10px] ml-2">
                      your avg top 10 vs field median
                    </span>
                  </div>
                </div>
              ) : null}

              <div className="border-t border-border/50 pt-2 space-y-1.5">
                <div className="text-[10px] font-medium text-muted-foreground">
                  Single-lap reference (optional — one flyer can mislead)
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-foreground/90">
                  <span className="text-muted-foreground font-sans">Pole (session best lap)</span>
                  <span>{fmtSec(fs.sessionBestBestLapSeconds)}</span>
                  <span className="text-muted-foreground font-sans">Your best</span>
                  <span>{fmtSec(my.bestLapSeconds)}</span>
                  {fieldRel.gapBest != null ? (
                    <>
                      <span className="text-muted-foreground font-sans">
                        {fieldRel.vsFieldUsesSessionMeans ? "Best lap vs field average" : "Gap vs pole"}
                      </span>
                      <span>{fmtDeltaSec(fieldRel.gapBest)}</span>
                    </>
                  ) : null}
                </div>
              </div>

              {fs.paceVsFieldMeanAnalysis && fs.paceVsFieldMeanAnalysis.length > 0 ? (
                <div className="border-t border-border/50 pt-1.5 space-y-1">
                  <div className="text-[10px] font-medium text-muted-foreground">All metrics vs session field average</div>
                  <p className="text-[9px] text-muted-foreground leading-snug">
                    Mean = arithmetic average across entrants with a finite value for that metric. Gap = your time minus
                    that mean (positive ⇒ slower than average).
                  </p>
                  <div className="overflow-x-auto rounded-md border border-border/60 bg-background/40">
                    <table className="w-full text-left text-[9px]">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground">
                          <th className="px-1.5 py-1 font-medium">Metric</th>
                          <th className="px-1.5 py-1 font-medium">Field avg</th>
                          <th className="px-1.5 py-1 font-medium">You</th>
                          <th className="px-1.5 py-1 font-medium">vs avg</th>
                          <th className="px-1.5 py-1 font-medium">Rank</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono text-foreground/90">
                        {fs.paceVsFieldMeanAnalysis.map((m) => (
                          <tr
                            key={m.metric}
                            className={cn("border-b border-border/50 last:border-0", !m.meaningful && "opacity-70")}
                          >
                            <td className="px-1.5 py-0.5 font-sans text-[9px] text-foreground/85">
                              {m.label}
                              {!m.meaningful ? <span className="text-muted-foreground"> *</span> : null}
                            </td>
                            <td className="px-1.5 py-0.5 tabular-nums">{fmtSec(m.fieldMeanSeconds)}</td>
                            <td className="px-1.5 py-0.5 tabular-nums">{fmtSec(m.userSeconds)}</td>
                            <td className="px-1.5 py-0.5 tabular-nums">{fmtDeltaSec(m.gapUserMinusFieldMeanSeconds)}</td>
                            <td className="px-1.5 py-0.5 tabular-nums font-sans text-[8px]">
                              {m.rankInField != null && m.fieldEntrantCountForMetric >= 2
                                ? `${m.rankInField}/${m.fieldEntrantCountForMetric}`
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[8px] text-muted-foreground">
                    * Avg top N on your row needs at least N included laps (same rule as lap summary).
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-[11px] text-foreground/90 leading-snug">
              Field has {fs.driverCount} drivers in this imported timing session, but your row was not matched to a
              primary imported driver name. Use the field table below to confirm how you appear in timing.
            </p>
          )}
        </div>
      );
    }

    if (ranked.length >= 2 && f) {
      const you = ranked.find((r) => r.isPrimaryUser) ?? ranked[0];
      if (!you) return null;
      const rankLine =
        you.rank != null && ranked.length >= 2 ? `${you.rank} of ${ranked.length} by best lap` : null;
      const fadeNote =
        you.fadeSeconds != null && Number.isFinite(you.fadeSeconds)
          ? `${you.fadeSeconds >= 0 ? "+" : ""}${you.fadeSeconds.toFixed(3)}s (2nd half mean − 1st half mean of included laps)`
          : null;
      return (
        <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5 space-y-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Pace vs field</div>
          {rankLine ? <div className="text-sm font-semibold text-foreground tabular-nums">{rankLine}</div> : null}
          <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 font-mono text-[12px] tabular-nums text-foreground/90">
            <span className="text-muted-foreground font-sans text-[11px]">Pole (session best lap)</span>
            <span>{fmtSec(f.sessionBestLapSeconds)}</span>
            <span className="text-muted-foreground font-sans text-[11px]">Your best</span>
            <span>{fmtSec(you.bestLapSeconds)}</span>
            {fieldRel.gapBest != null ? (
              <>
                <span className="text-muted-foreground font-sans text-[11px]">Gap vs pole</span>
                <span>{fmtDeltaSec(fieldRel.gapBest)}</span>
              </>
            ) : null}
          </div>
          {fadeNote ? (
            <p className="text-[10px] text-muted-foreground leading-snug border-t border-border/50 pt-1.5">
              Stint fade: {fadeNote}
            </p>
          ) : null}
        </div>
      );
    }
  }

  if (summary.importedProvenance && !fieldRel.multiDriverField) {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground leading-snug">
        Pace vs field needs at least two drivers in this imported timing session. When the timing source lists more
        entrants, rank and gaps will appear here.
      </div>
    );
  }

  return null;
}

function FieldImportSessionFieldTable({ summary }: { summary: EngineerRunSummaryV2 }) {
  if (!summary.fieldImportSession || summary.fieldImportSession.ranked.length < 2) return null;
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Imported session — field
      </div>
      <p className="text-[10px] leading-snug text-muted-foreground">
        Same timing import, multiple drivers. Rank and gap use each driver&apos;s best included lap vs session best.
        Fade is mean(second half) − mean(first half) of included laps (needs ≥4 laps).
      </p>
      <div className="md:hidden space-y-1.5">
        {summary.fieldImportSession.ranked.map((row, i) => (
          <div
            key={`${row.label}-${i}-m`}
            className={cn(
              "rounded-md border border-border bg-muted/40 px-2 py-1.5 text-[10px] leading-tight",
              row.isPrimaryUser && "bg-primary/5"
            )}
          >
            <div className="font-sans text-foreground/90">
              {row.label}
              {row.isPrimaryUser ? <span className="ml-1 text-[9px] text-muted-foreground">(you)</span> : null}
            </div>
            <div className="mt-1 grid grid-cols-4 gap-x-2 gap-y-0.5 font-mono text-[9px] text-foreground/85">
              <span>
                <span className="block text-[8px] font-sans text-muted-foreground">Rk</span>
                {row.rank}
              </span>
              <span>
                <span className="block text-[8px] font-sans text-muted-foreground">Best</span>
                {fmtSec(row.bestLapSeconds)}
              </span>
              <span>
                <span className="block text-[8px] font-sans text-muted-foreground">Gap</span>
                {row.gapToSessionBestSeconds == null || !Number.isFinite(row.gapToSessionBestSeconds)
                  ? "—"
                  : row.gapToSessionBestSeconds.toFixed(3)}
              </span>
              <span>
                <span className="block text-[8px] font-sans text-muted-foreground">Fade</span>
                {fmtSec(row.fadeSeconds)}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="hidden md:block overflow-x-auto rounded-md border border-border bg-muted/40">
        <table className="w-full text-left text-[10px]">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">Driver</th>
              <th className="px-2 py-1.5 font-medium">Rank</th>
              <th className="px-2 py-1.5 font-medium">Best</th>
              <th className="px-2 py-1.5 font-medium">Gap to P1</th>
              <th className="px-2 py-1.5 font-medium">Fade</th>
            </tr>
          </thead>
          <tbody className="font-mono text-foreground/90">
            {summary.fieldImportSession.ranked.map((row, i) => (
              <tr key={`${row.label}-${i}`} className={row.isPrimaryUser ? "bg-primary/5" : undefined}>
                <td className="px-2 py-1">
                  {row.label}
                  {row.isPrimaryUser ? (
                    <span className="ml-1 text-[9px] text-muted-foreground font-sans">(your row)</span>
                  ) : null}
                </td>
                <td className="px-2 py-1 tabular-nums">{row.rank}</td>
                <td className="px-2 py-1 tabular-nums">{fmtSec(row.bestLapSeconds)}</td>
                <td className="px-2 py-1 tabular-nums">
                  {row.gapToSessionBestSeconds == null || !Number.isFinite(row.gapToSessionBestSeconds)
                    ? "—"
                    : row.gapToSessionBestSeconds.toFixed(3)}
                </td>
                <td className="px-2 py-1 tabular-nums">{fmtSec(row.fadeSeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Pace vs imported field (session best, mean analysis, driver table). Used in Engineer run summary and Sessions lap analysis.
 */
export function EngineerPaceVsFieldPanel({ summary }: { summary: EngineerRunSummaryV2 }) {
  const fieldRel = fieldRelativityForSummary(summary);
  return (
    <div className="space-y-3">
      <PaceVsFieldHero summary={summary} fieldRel={fieldRel} />
      <FieldImportSessionFieldTable summary={summary} />
    </div>
  );
}
