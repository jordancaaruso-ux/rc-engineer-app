"use client";

import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { formatLap, formatStintTime, normalizeLapTimes } from "@/lib/runLaps";
import { DEFAULT_SETUP_FIELDS, normalizeSetupData } from "@/lib/runSetup";
import { displayRunNotes } from "@/lib/runNotes";
import { formatLapSourceSummary, tryReadLapSourceUrl } from "@/lib/lapSession/display";
import type { RunCompareListSource } from "@/lib/runCompareCatalog";
import type { CompareRunShape } from "@/components/runs/RunComparePanel";
import { SetupSheetModal, type SetupSheetModalRun } from "@/components/setup-sheet/SetupSheetModal";
import {
  getAverageTopN,
  getBestLap,
  getIncludedLapDashboardMetrics,
  primaryLapRowsFromRun,
} from "@/lib/lapAnalysis";
import { LapComparisonColumnGrid } from "@/components/runs/LapComparisonColumnGrid";
import { toCompareRunShape } from "@/lib/runCompareShape";

type Run = {
  id: string;
  createdAt: Date | string;
  carId: string | null;
  eventId: string | null;
  sessionType: string;
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
  sessionLabel?: string | null;
  carNameSnapshot?: string | null;
  trackNameSnapshot?: string | null;
  tireRunNumber: number;
  lapTimes: unknown;
  notes?: string | null;
  driverNotes?: string | null;
  handlingProblems?: string | null;
  suggestedChanges?: string | null;
  car?: { id: string; name: string; setupSheetTemplate?: string | null } | null;
  track?: { id: string; name: string } | null;
  tireSet?: { id: string; label: string; setNumber: number | null } | null;
  event?: { name: string; track?: { name: string } | null } | null;
  setupSnapshot?: { id: string; data: unknown } | null;
  lapSession?: unknown;
  importedLapSets?: Array<{
    id: string;
    driverId?: string | null;
    driverName: string;
    displayName?: string | null;
    normalizedName: string;
    isPrimaryUser: boolean;
    laps: Array<{
      lapNumber: number;
      lapTimeSeconds: number;
      isIncluded?: boolean;
    }>;
  }>;
};

function formatLapSourceLinkText(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname + u.search;
    const pathShort = path.length > 26 ? `${path.slice(0, 24)}…` : path;
    return `${u.hostname}${pathShort || "/"}`;
  } catch {
    return url.length > 42 ? `${url.slice(0, 39)}…` : url;
  }
}

function CompactField({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-w-[5.5rem] max-w-[220px] shrink-0">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xs text-foreground break-words">{children ?? value ?? "—"}</div>
    </div>
  );
}

function LapStatChip({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="rounded border border-border bg-muted/80 px-2 py-1 min-w-[4.5rem]" title={title}>
      <div className="text-[9px] font-medium text-muted-foreground leading-none mb-0.5">{label}</div>
      <div className="text-[11px] font-mono tabular-nums text-foreground leading-tight">{value}</div>
    </div>
  );
}

/** Primary action buttons (analyse setup / lap times) — identical styling */
const analyseActionButtonClass =
  "rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-glow-sm hover:brightness-105 transition";

function setupRows(data: unknown): { label: string; value: string }[] {
  const obj = normalizeSetupData(data);
  const seen = new Set<string>();
  const rows: { label: string; value: string }[] = [];
  for (const f of DEFAULT_SETUP_FIELDS) {
    if (f.key in obj && obj[f.key] != null && String(obj[f.key]).trim() !== "") {
      rows.push({ label: f.label + (f.unit ? ` (${f.unit})` : ""), value: String(obj[f.key]) });
      seen.add(f.key);
    }
  }
  for (const key of Object.keys(obj).sort()) {
    if (seen.has(key)) continue;
    const v = obj[key];
    if (v == null || String(v).trim() === "") continue;
    rows.push({ label: key.replace(/_/g, " "), value: String(v) });
  }
  return rows;
}

export function RunHistoryTable({
  runs,
  allRunsDescending,
  runListSource = "my_runs",
  userDisplayName,
}: {
  runs: Run[];
  allRunsDescending: CompareRunShape[];
  runListSource?: RunCompareListSource;
  /** User / driver name for primary lap column ("Me" if unset). */
  userDisplayName?: string | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function toggleRow(runId: string) {
    setExpandedId((prev) => (prev === runId ? null : runId));
  }

  return (
    <>
      {runs.map((run) => {
        const isExpanded = expandedId === run.id;
        const carDisplay = run.car?.name ?? run.carNameSnapshot ?? "Deleted car";
        const trackDisplay = run.track?.name ?? run.trackNameSnapshot ?? "—";
        const tiresDisplay = run.tireSet
          ? `${run.tireSet.label} · Set ${run.tireSet.setNumber ?? "—"} · Run ${run.tireRunNumber}`
          : "—";

        return (
          <React.Fragment key={run.id}>
            <tr
              role="button"
              tabIndex={0}
              onClick={() => toggleRow(run.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleRow(run.id);
                }
              }}
              className="border-b border-border/80 hover:bg-muted/50 cursor-pointer select-none"
              aria-expanded={isExpanded}
            >
              <td className="px-4 py-2">
                {formatRunCreatedAtDateTime(run.createdAt)}
              </td>
              <td className="px-4 py-2">{carDisplay}</td>
              <td className="px-4 py-2">{trackDisplay}</td>
              <td className="px-4 py-2">{tiresDisplay}</td>
              <td className="px-4 py-2">
                {formatLap(getBestLap(primaryLapRowsFromRun(run)))}
              </td>
              <td className="px-4 py-2">
                {formatLap(getAverageTopN(primaryLapRowsFromRun(run), 5))}
              </td>
              <td className="px-4 py-2">{formatRunSessionDisplay(run)}</td>
            </tr>
            {isExpanded && (
              <tr className="border-b border-border/80 bg-muted/40">
                <td colSpan={7} className="px-4 py-4">
                  <RunDetail
                    run={run}
                    pickerRuns={allRunsDescending}
                    runListSource={runListSource}
                    userDisplayName={userDisplayName}
                  />
                </td>
              </tr>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

function RunDetail({
  run,
  pickerRuns,
  runListSource,
  userDisplayName,
}: {
  run: Run;
  pickerRuns: CompareRunShape[];
  runListSource: RunCompareListSource;
  userDisplayName?: string | null;
}) {
  const [setupOpen, setSetupOpen] = React.useState(false);
  const [showLapAnalysis, setShowLapAnalysis] = React.useState(false);
  /** Compare / load-setup pickers only offer runs for this vehicle. */
  const pickerRunsSameCar = useMemo(() => {
    if (!run.carId) return pickerRuns;
    return pickerRuns.filter((r) => r.car?.id === run.carId);
  }, [pickerRuns, run.carId]);
  const carDisplay = run.car?.name ?? run.carNameSnapshot ?? "Deleted car";
  const trackDisplay = run.track?.name ?? run.trackNameSnapshot ?? "—";
  const laps = normalizeLapTimes(run.lapTimes);
  const meetingType =
    run.sessionType === "RACE_MEETING" || run.sessionType === "PRACTICE"
      ? run.meetingSessionType === "OTHER" && run.meetingSessionCode?.trim()
        ? run.meetingSessionCode.trim()
        : run.meetingSessionType
          ? {
              PRACTICE: "Practice",
              SEEDING: "Seeding",
              QUALIFYING: "Qualifying",
              RACE: "Race",
              OTHER: "Other",
            }[run.meetingSessionType] ?? run.meetingSessionType
          : "—"
      : "—";
  const setupList = setupRows(run.setupSnapshot?.data);
  const ownRows = primaryLapRowsFromRun(run);
  const lapDash = getIncludedLapDashboardMetrics(ownRows);
  const sourceUrl = tryReadLapSourceUrl(run.lapSession);
  const sourceSummary = formatLapSourceSummary(run.lapSession);
  const uploadedLapSetCount = run.importedLapSets?.length ?? 0;
  const uploadedLapSetsLine =
    uploadedLapSetCount === 0
      ? "No additional driver lap sets uploaded"
      : uploadedLapSetCount === 1
        ? "1 driver lap set uploaded"
        : `${uploadedLapSetCount} driver lap sets uploaded`;

  return (
    <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-5 text-sm">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:gap-6">
        <div className="min-w-0 space-y-3 xl:max-w-[min(100%,28rem)]">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Run details</h3>
          <div className="flex flex-wrap gap-x-5 gap-y-3">
            <CompactField label="Date / time" value={formatRunCreatedAtDateTime(run.createdAt)} />
            <CompactField
              label="Session type"
              value={run.sessionType === "RACE_MEETING" || run.sessionType === "PRACTICE" ? "Race Meeting" : "Testing"}
            />
            <CompactField label="Meeting session" value={meetingType} />
            <CompactField label="Label" value={run.sessionLabel?.trim() || "—"} />
            <CompactField label="Car" value={carDisplay} />
            <CompactField label="Track" value={trackDisplay} />
            <CompactField
              label="Tire set"
              value={
                run.tireSet
                  ? `${run.tireSet.label} · Set ${run.tireSet.setNumber ?? "—"} · Run ${run.tireRunNumber}`
                  : "—"
              }
            />
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-2 border-t border-border pt-4 xl:border-t-0 xl:border-l xl:border-border xl:pt-0 xl:pl-6">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Lap times</h3>

          <div className="space-y-1">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Included-lap metrics
            </div>
            <div className="flex flex-wrap gap-1.5">
              <LapStatChip label="Laps" value={String(lapDash.lapCount)} />
              <LapStatChip
                label="Stint"
                title="Sum of included lap times"
                value={
                  lapDash.stintSeconds != null ? formatStintTime(lapDash.stintSeconds) : "—"
                }
              />
              <LapStatChip label="Best lap" value={formatLap(lapDash.bestLap)} />
              <LapStatChip label="Avg top 5" value={formatLap(lapDash.avgTop5)} />
              <LapStatChip label="Avg top 10" value={formatLap(lapDash.avgTop10)} />
              <LapStatChip label="Median" value={formatLap(lapDash.median)} />
              <LapStatChip
                label="Consistency"
                title="100 − CV; higher = more consistent laps"
                value={
                  lapDash.consistencyScore != null ? `${lapDash.consistencyScore.toFixed(1)}%` : "—"
                }
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              All laps ({laps.length})
            </div>
            {laps.length > 0 ? (
              <ul className="font-mono text-[11px] grid grid-cols-[auto_1fr_auto] gap-x-2 gap-y-0.5 max-h-32 overflow-y-auto rounded border border-border bg-muted/60 px-2 py-1.5">
                {(ownRows.length === laps.length ? ownRows : laps.map((t, i) => ({
                  lapNumber: i + 1,
                  lapTimeSeconds: t,
                  isIncluded: true,
                }))).map((r, i) => (
                  <React.Fragment key={i}>
                    <span
                      className={cn(
                        "text-muted-foreground",
                        !r.isIncluded && "opacity-50 line-through"
                      )}
                    >
                      {r.lapNumber}.
                    </span>
                    <span className={cn(!r.isIncluded && "opacity-50 line-through")}>
                      {r.lapTimeSeconds.toFixed(3)}s
                    </span>
                    {!r.isIncluded ? (
                      <span className="text-[9px] uppercase text-muted-foreground">Excluded</span>
                    ) : (
                      <span />
                    )}
                  </React.Fragment>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-muted-foreground">—</div>
            )}
          </div>

          <div className="space-y-1 pt-1 border-t border-border/60 border-dashed">
            <div className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground/80">Lap source</div>
            <div className="text-[11px] space-y-1 text-muted-foreground">
              <div className="text-muted-foreground/90">{sourceSummary ?? "—"}</div>
              {sourceUrl ? (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block max-w-full text-accent/90 underline underline-offset-2 break-all text-[11px]"
                  title={sourceUrl}
                >
                  {formatLapSourceLinkText(sourceUrl)}
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="space-y-0.5 min-w-0">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Lap analysis</h3>
            <p className="text-[11px] text-muted-foreground">{uploadedLapSetsLine}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowLapAnalysis((v) => !v)}
            className={cn("shrink-0", analyseActionButtonClass)}
          >
            Analyse lap times
          </button>
        </div>
        {showLapAnalysis ? (
          <div className="rounded-md border border-border bg-muted/60 p-3">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Column comparison
            </div>
            <LapComparisonColumnGrid
              myDisplayName={userDisplayName}
              run={run}
              currentRunId={run.id}
              otherRuns={pickerRunsSameCar.filter((r) => r.id !== run.id)}
              compareAnchorRun={toCompareRunShape(run)}
              pickerRunsForModal={pickerRunsSameCar}
              runListSource={runListSource}
            />
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <DetailRow
          label="Notes"
          value={displayRunNotes(run) || "—"}
          multiline
          emptyAsDash
        />
        <DetailRow
          label="Things to try"
          value={run.suggestedChanges?.trim() || "—"}
          multiline
          emptyAsDash
        />
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => setSetupOpen(true)} className={analyseActionButtonClass}>
            Analyse setup
          </button>
        </div>
        {setupList.length === 0 ? (
          <p className="text-muted-foreground text-xs">No setup parameters recorded for this run.</p>
        ) : (
          <div className="rounded-md border border-border bg-muted/70 divide-y divide-border max-h-48 overflow-y-auto">
            {setupList.map((row) => (
              <div key={row.label} className="px-3 py-2 flex flex-wrap justify-between gap-2 text-xs">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="font-mono">{row.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <SetupSheetModal
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        run={run as SetupSheetModalRun}
        pickerRuns={pickerRunsSameCar as SetupSheetModalRun[]}
        runListSource={runListSource}
      />
    </div>
  );
}

function DetailRow({
  label,
  value,
  multiline,
  emptyAsDash,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  emptyAsDash?: boolean;
}) {
  const show = emptyAsDash && !value.trim() ? "—" : value;
  return (
    <div>
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <div className={multiline ? "mt-0.5 whitespace-pre-wrap text-foreground" : "mt-0.5 text-foreground"}>{show}</div>
    </div>
  );
}
