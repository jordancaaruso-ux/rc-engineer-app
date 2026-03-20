"use client";

import { useEffect, useMemo, useState } from "react";
import { bestLap, avgTop5, formatLap } from "@/lib/runLaps";
import { buildSetupDiffRows, normalizeSetupData } from "@/lib/setupDiff";
import type { RunCompareListSource } from "@/lib/runCompareCatalog";
import { formatRunPickerLine } from "@/lib/runPickerFormat";
import { RunPickerSelect } from "@/components/runs/RunPickerSelect";
import {
  getActiveSetupData,
  ACTIVE_SETUP_CHANGED_EVENT,
} from "@/lib/activeSetupContext";
import { displayRunNotes } from "@/lib/runNotes";

export type CompareRunShape = {
  id: string;
  createdAt: Date | string;
  sessionType: string;
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
  sessionLabel?: string | null;
  car?: { id: string; name: string } | null;
  carNameSnapshot?: string | null;
  track?: { id: string; name: string } | null;
  trackNameSnapshot?: string | null;
  lapTimes: unknown;
  notes?: string | null;
  driverNotes?: string | null;
  handlingProblems?: string | null;
  tireSet?: { id: string; label: string; setNumber: number | null } | null;
  tireRunNumber: number;
  setupSnapshot?: { id: string; data: unknown } | null;
};

type CompareMode = "current_setup" | "choose_run";

export function RunComparePanel({
  runListSource,
  baseRun,
  pickerRuns,
}: {
  runListSource: RunCompareListSource;
  baseRun: CompareRunShape;
  /** Newest first; same list as Load setup / for-picker. */
  pickerRuns: CompareRunShape[];
}) {
  const [mode, setMode] = useState<CompareMode>("current_setup");
  const [otherRunId, setOtherRunId] = useState("");
  const [activeTick, setActiveTick] = useState(0);

  useEffect(() => {
    const bump = () => setActiveTick((t) => t + 1);
    window.addEventListener(ACTIVE_SETUP_CHANGED_EVENT, bump);
    return () => window.removeEventListener(ACTIVE_SETUP_CHANGED_EVENT, bump);
  }, []);

  const activeSetup = useMemo(() => {
    void activeTick;
    return getActiveSetupData();
  }, [activeTick]);

  const hasActiveSetup = useMemo(() => {
    const a = activeSetup;
    if (!a) return false;
    return Object.keys(a).some((k) => {
      const v = a[k];
      return v != null && String(v).trim() !== "";
    });
  }, [activeSetup]);

  const otherRuns = useMemo(
    () => pickerRuns.filter((r) => r.id !== baseRun.id),
    [pickerRuns, baseRun.id]
  );

  const baselineRun = useMemo(() => {
    if (mode !== "choose_run" || !otherRunId) return null;
    return pickerRuns.find((r) => r.id === otherRunId) ?? null;
  }, [mode, otherRunId, pickerRuns]);

  const historicalSetup = normalizeSetupData(baseRun.setupSnapshot?.data);

  const baselineForDiff = useMemo(() => {
    if (mode === "choose_run") {
      if (!baselineRun) return null;
      return normalizeSetupData(baselineRun.setupSnapshot?.data);
    }
    if (!hasActiveSetup) return null;
    return normalizeSetupData(activeSetup ?? {});
  }, [mode, baselineRun, hasActiveSetup, activeSetup]);

  const allRows = useMemo(() => {
    if (mode === "current_setup" && !hasActiveSetup) return [];
    if (mode === "choose_run" && !baselineRun) return [];
    return buildSetupDiffRows(historicalSetup, baselineForDiff);
  }, [
    mode,
    hasActiveSetup,
    baselineRun,
    historicalSetup,
    baselineForDiff,
  ]);

  const [showAllSetup, setShowAllSetup] = useState(false);
  const diffRows = showAllSetup ? allRows : allRows.filter((row) => row.changed);

  const rightLabel = mode === "current_setup" ? "Current setup" : "Other run";

  const sourceNote =
    runListSource === "my_runs"
      ? "Compare this completed run to your working setup or another run."
      : "Team context (future).";

  const lapsRight =
    mode === "current_setup"
      ? "—"
      : baselineRun
        ? formatLap(bestLap(baselineRun.lapTimes))
        : "—";
  const avgRight =
    mode === "current_setup"
      ? "—"
      : baselineRun
        ? formatLap(avgTop5(baselineRun.lapTimes))
        : "—";

  const notesCompareRight =
    mode === "current_setup" ? null : baselineRun ? displayRunNotes(baselineRun) : null;

  const tiresRight =
    mode === "current_setup"
      ? "—"
      : baselineRun && baselineRun.tireSet
        ? `${baselineRun.tireSet.label} · Set ${baselineRun.tireSet.setNumber ?? "—"} · Run ${baselineRun.tireRunNumber}`
        : "—";

  return (
    <div
      className="mt-4 rounded-lg border border-border bg-secondary/15 p-4 space-y-4 text-sm"
      onClick={(e) => e.stopPropagation()}
    >
      <div>
        <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-wide">
          Compare setup
        </h3>
        <p className="text-xs text-muted-foreground mt-1">{sourceNote}</p>
      </div>

      <div className="space-y-2">
        <span className="text-[11px] font-mono text-muted-foreground">Compare to</span>
        <div className="flex flex-wrap gap-2">
          <ModeChip
            active={mode === "current_setup"}
            onClick={() => setMode("current_setup")}
            label="Current setup"
          />
          <ModeChip
            active={mode === "choose_run"}
            onClick={() => setMode("choose_run")}
            label="Choose run"
            disabled={otherRuns.length === 0}
          />
        </div>
        {mode === "choose_run" && otherRuns.length > 0 && (
          <div className="pt-1 max-w-2xl">
            <RunPickerSelect
              label="Past run"
              runs={otherRuns}
              value={otherRunId}
              onChange={setOtherRunId}
              placeholder="Select a run to compare…"
            />
          </div>
        )}
      </div>

      {mode === "current_setup" && !hasActiveSetup && (
        <p className="text-xs text-amber-600/90 dark:text-amber-400/90">
          No current setup yet. Open <strong>Log your run</strong>—setup fields sync here. Or load a past setup from
          the dropdown there.
        </p>
      )}

      {mode === "choose_run" && !otherRunId ? (
        <p className="text-xs text-muted-foreground">Select a run from the list.</p>
      ) : mode === "choose_run" && !baselineRun ? null : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 text-xs">
            <div className="rounded-md border border-border bg-secondary/20 p-3 space-y-1">
              <div className="font-mono text-muted-foreground">This run (history)</div>
              <div className="font-mono text-[11px] break-words">{formatRunPickerLine(baseRun)}</div>
            </div>
            <div className="rounded-md border border-border bg-secondary/20 p-3 space-y-1">
              <div className="font-mono text-muted-foreground">{rightLabel}</div>
              {mode === "current_setup" ? (
                <p className="text-muted-foreground text-[11px]">
                  Values from Log your run (last saved locally).
                </p>
              ) : baselineRun ? (
                <div className="font-mono text-[11px] break-words">{formatRunPickerLine(baselineRun)}</div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <LapBlock
              title="Best lap"
              left={formatLap(bestLap(baseRun.lapTimes))}
              right={lapsRight}
              rightLabel={rightLabel}
            />
            <LapBlock
              title="Avg top 5"
              left={formatLap(avgTop5(baseRun.lapTimes))}
              right={avgRight}
              rightLabel={rightLabel}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <NoteBlock title="Notes · this run" text={displayRunNotes(baseRun)} />
            <NoteBlock
              title={`Notes · ${mode === "current_setup" ? "current setup" : "other run"}`}
              text={notesCompareRight}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 text-xs">
            <div>
              <span className="font-mono text-muted-foreground">Tires · this run</span>
              <p className="mt-1">
                {baseRun.tireSet
                  ? `${baseRun.tireSet.label} · Set ${baseRun.tireSet.setNumber ?? "—"} · Run ${baseRun.tireRunNumber}`
                  : "—"}
              </p>
            </div>
            <div>
              <span className="font-mono text-muted-foreground">Tires · {rightLabel.toLowerCase()}</span>
              <p className="mt-1">{tiresRight}</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wide">
                Setup values
              </h4>
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showAllSetup}
                  onChange={(e) => setShowAllSetup(e.target.checked)}
                  className="rounded border-border"
                />
                Show all setup values
              </label>
            </div>
            {!showAllSetup && (
              <p className="text-[11px] text-muted-foreground">
                Showing changed values only. Toggle to see every parameter.
              </p>
            )}
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/20 text-left text-xs font-mono text-muted-foreground">
                    <th className="px-3 py-2">Parameter</th>
                    <th className="px-3 py-2">This run</th>
                    <th className="px-3 py-2">{rightLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {diffRows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-4 text-center text-muted-foreground text-xs">
                        {mode === "current_setup" && !hasActiveSetup
                          ? "Open Log your run and enter or load a setup to compare."
                          : showAllSetup
                            ? "No setup on one or both sides."
                            : "No differing values. Toggle to show all."}
                      </td>
                    </tr>
                  ) : (
                    diffRows.map((r) => (
                      <tr
                        key={r.key}
                        className={
                          r.changed
                            ? "border-b border-border/50 bg-yellow-500/10 dark:bg-yellow-500/5"
                            : "border-b border-border/50"
                        }
                      >
                        <td className="px-3 py-2">
                          {r.label}
                          {r.unit ? (
                            <span className="text-muted-foreground text-xs ml-1">({r.unit})</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{r.current}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          {r.previous ?? "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ModeChip({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
        disabled
          ? "border-border/50 text-muted-foreground/50 cursor-not-allowed"
          : active
            ? "border-accent bg-accent/15 text-foreground"
            : "border-border bg-secondary/30 hover:bg-secondary/50"
      }`}
    >
      {label}
    </button>
  );
}

function LapBlock({
  title,
  left,
  right,
  rightLabel,
}: {
  title: string;
  left: string;
  right: string;
  rightLabel: string;
}) {
  return (
    <div className="rounded-md border border-border bg-secondary/10 px-3 py-2 text-xs">
      <div className="font-mono text-muted-foreground">{title}</div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        <span>
          This run: <span className="font-mono text-foreground">{left}</span>
        </span>
        <span>
          {rightLabel}: <span className="font-mono text-foreground">{right}</span>
        </span>
      </div>
    </div>
  );
}

function NoteBlock({ title, text }: { title: string; text?: string | null }) {
  const v = text?.trim() || "—";
  return (
    <div className="rounded-md border border-border bg-secondary/10 px-3 py-2 text-xs">
      <div className="font-mono text-muted-foreground">{title}</div>
      <p className="mt-1 whitespace-pre-wrap text-foreground">{v}</p>
    </div>
  );
}
