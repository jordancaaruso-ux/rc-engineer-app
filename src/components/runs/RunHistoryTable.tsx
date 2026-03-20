"use client";

import React, { useState } from "react";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { bestLap, avgTop5, formatLap, normalizeLapTimes } from "@/lib/runLaps";
import { DEFAULT_SETUP_FIELDS, normalizeSetupData } from "@/lib/runSetup";
import { displayRunNotes } from "@/lib/runNotes";
import type { RunCompareListSource } from "@/lib/runCompareCatalog";
import type { CompareRunShape } from "@/components/runs/RunComparePanel";
import { SetupSheetModal, type SetupSheetModalRun } from "@/components/setup-sheet/SetupSheetModal";

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
};

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
}: {
  runs: Run[];
  allRunsDescending: CompareRunShape[];
  runListSource?: RunCompareListSource;
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
              className="border-b border-border/50 hover:bg-secondary/10 cursor-pointer select-none"
              aria-expanded={isExpanded}
            >
              <td className="px-4 py-2">
                {formatRunCreatedAtDateTime(run.createdAt)}
              </td>
              <td className="px-4 py-2">{carDisplay}</td>
              <td className="px-4 py-2">{trackDisplay}</td>
              <td className="px-4 py-2">{tiresDisplay}</td>
              <td className="px-4 py-2">{formatLap(bestLap(run.lapTimes))}</td>
              <td className="px-4 py-2">{formatLap(avgTop5(run.lapTimes))}</td>
              <td className="px-4 py-2">{formatRunSessionDisplay(run)}</td>
            </tr>
            {isExpanded && (
              <tr className="border-b border-border/50 bg-secondary/5">
                <td colSpan={7} className="px-4 py-4">
                  <RunDetail
                    run={run}
                    pickerRuns={allRunsDescending}
                    runListSource={runListSource}
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
}: {
  run: Run;
  pickerRuns: CompareRunShape[];
  runListSource: RunCompareListSource;
}) {
  const [setupOpen, setSetupOpen] = React.useState(false);
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

  return (
    <div className="rounded-lg border border-border bg-secondary/10 p-4 space-y-5 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="text-xs font-mono text-muted-foreground">Run review</div>
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setSetupOpen(true)}
            className="rounded-md bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground hover:brightness-110 transition"
          >
            View setup
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-wide">Run context</h3>
          <DetailRow label="Date / time" value={formatRunCreatedAtDateTime(run.createdAt)} />
          <DetailRow label="Session type" value={run.sessionType === "RACE_MEETING" || run.sessionType === "PRACTICE" ? "Race Meeting" : "Testing"} />
          <DetailRow label="Meeting session type" value={meetingType} />
          <DetailRow label="Label" value={run.sessionLabel?.trim() || "—"} />
          <DetailRow label="Car" value={carDisplay} />
          <DetailRow label="Track" value={trackDisplay} />
          <DetailRow
            label="Tire set"
            value={run.tireSet ? `${run.tireSet.label} · Set ${run.tireSet.setNumber ?? "—"} · Run ${run.tireRunNumber}` : "—"}
          />
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-wide">Lap times</h3>
          <DetailRow
            label="Lap source"
            value={formatLapSourceSummary(run.lapSession) || "Manual"}
          />
          <DetailRow label="Best lap" value={formatLap(bestLap(run.lapTimes))} />
          <DetailRow label="Average (top 5)" value={formatLap(avgTop5(run.lapTimes))} />
          {laps.length > 0 ? (
            <div>
              <span className="text-[11px] font-mono text-muted-foreground">All laps ({laps.length})</span>
              <ul className="mt-1 font-mono text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 max-h-40 overflow-y-auto rounded-md border border-border bg-secondary/20 p-2">
                {laps.map((t, i) => (
                  <React.Fragment key={i}>
                    <span className="text-muted-foreground">{i + 1}.</span>
                    <span>{t.toFixed(3)}s</span>
                  </React.Fragment>
                ))}
              </ul>
            </div>
          ) : (
            <DetailRow label="All laps" value="—" />
          )}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-wide">Notes</h3>
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
        {setupList.length === 0 ? (
          <p className="text-muted-foreground text-xs">No setup parameters recorded for this run.</p>
        ) : (
          <div className="rounded-md border border-border bg-secondary/20 divide-y divide-border max-h-48 overflow-y-auto">
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
        pickerRuns={pickerRuns as SetupSheetModalRun[]}
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
      <span className="text-[11px] font-mono text-muted-foreground">{label}</span>
      <div className={multiline ? "mt-0.5 whitespace-pre-wrap text-foreground" : "mt-0.5 text-foreground"}>{show}</div>
    </div>
  );
}
