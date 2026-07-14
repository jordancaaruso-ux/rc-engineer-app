"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Wrench } from "lucide-react";
import type { AnalysisRecentRun } from "@/lib/analysis/analysisHomeModel";
import { TireIndicatorIcon } from "@/components/runs/TireIndicatorIcon";
import { SetupSheetModal, type SetupSheetModalRun } from "@/components/runs/RunHistoryModalsLazy";
import { CardPanel } from "@/components/ui/CardPanel";
import { Collapse } from "@/components/ui/Collapse";
import { Eyebrow, StatStrip, StatTile } from "@/components/ui/panel";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { cn } from "@/lib/utils";

/**
 * Last four runs as an accordion — the list lands compressed, then the most
 * recent run unfolds on its own after a short beat (entrance choreography);
 * opening another row collapses the rest. All expand/collapse is animated.
 */

/** 460ms Reveal entrance + ~350ms beat on the compressed list before the top run unfolds. */
const AUTO_OPEN_DELAY_MS = 810;

function seconds(value: number | null): string {
  return value == null ? "—" : value.toFixed(3);
}

function PbChip({ run }: { run: AnalysisRecentRun }) {
  if (!run.isTrackCarPb) return null;
  return (
    <span className="inline-flex items-center rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-[0.1em] text-emerald-300">
      PB
    </span>
  );
}

export function RecentRunsCard({ runs }: { runs: AnalysisRecentRun[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const interactedRef = useRef(false);
  const [setupModal, setSetupModal] = useState<{
    run: SetupSheetModalRun;
    pickerRuns: SetupSheetModalRun[];
  } | null>(null);
  const [setupLoadingRunId, setSetupLoadingRunId] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  useEffect(() => {
    const first = runs[0]?.id;
    if (!first || interactedRef.current) return;
    // Reduced motion = the end state immediately (motion.tsx doctrine): top run
    // open with no choreography and no height transition (motion-reduce class).
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setOpenId(first);
      return;
    }
    const timer = window.setTimeout(() => {
      if (!interactedRef.current) setOpenId(first);
    }, AUTO_OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
    // Entrance choreography plays once per mount, for the list we landed with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openSetupForRun = async (runId: string) => {
    setSetupLoadingRunId(runId);
    setSetupError(null);
    try {
      const res = await fetch(`/api/runs/for-setup-compare?runId=${encodeURIComponent(runId)}`, {
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as { runs?: SetupSheetModalRun[] };
      const pickerRuns = Array.isArray(data.runs) ? data.runs : [];
      const anchor = pickerRuns.find((r) => r.id === runId);
      if (!res.ok || !anchor) throw new Error("load failed");
      setSetupModal({ run: anchor, pickerRuns });
    } catch {
      setSetupError("Couldn't load the setup for this run.");
    } finally {
      setSetupLoadingRunId(null);
    }
  };

  if (runs.length === 0) {
    return (
      <CardPanel contentClassName="flex flex-col gap-3 p-4">
        <Eyebrow dot="muted">Recent runs</Eyebrow>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          No runs yet. Your last four runs land here with best lap, top-5 average, and median.
        </p>
        <ButtonLink href="/runs/new" className="self-start">
          Log your first run
        </ButtonLink>
      </CardPanel>
    );
  }

  return (
    <CardPanel contentClassName="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow dot="muted">Recent runs</Eyebrow>
        <Link
          href="/runs/history"
          className="group inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          See all sessions
          <ChevronRight
            className="h-3.5 w-3.5 text-primary transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </Link>
      </div>

      <div className="flex flex-col">
        {runs.map((run, index) => {
          const open = run.id === openId;
          return (
            <div key={run.id} className={cn(index > 0 && "border-t border-border")}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => {
                  interactedRef.current = true;
                  setOpenId(open ? null : run.id);
                }}
                className="tap-active flex w-full items-center justify-between gap-3 py-2.5 text-left"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[13.5px] font-semibold tracking-tight text-foreground">
                    {run.title}
                  </span>
                  <span className="type-timestamp truncate">{run.subLabel}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <PbChip run={run} />
                  <span className="font-mono text-[14px] font-medium tabular-nums text-foreground">
                    {seconds(run.metrics.best)}
                  </span>
                  <ChevronRight
                    className={cn(
                      "h-3.5 w-3.5 text-faint transition-transform",
                      open && "rotate-90 text-muted-foreground"
                    )}
                    aria-hidden
                  />
                </span>
              </button>

              <Collapse open={open}>
                  <div className="flex flex-col gap-2.5 pb-3">
                    <StatStrip gridClassName="grid-cols-2 sm:grid-cols-4">
                      <StatTile label="Best" value={seconds(run.metrics.best)} />
                      <StatTile label="Avg top 5" value={seconds(run.metrics.avgTop5)} />
                      <StatTile label="Avg top 10" value={seconds(run.metrics.avgTop10)} />
                      <StatTile label="Median" value={seconds(run.metrics.median)} />
                    </StatStrip>
                    <div className="flex items-center justify-between gap-3">
                      <Link
                        href={`/runs/history?focusRun=${encodeURIComponent(run.id)}`}
                        className="group inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Open run
                        <ChevronRight
                          className="h-3.5 w-3.5 text-primary transition-transform group-hover:translate-x-0.5"
                          aria-hidden
                        />
                      </Link>
                      <span className="flex shrink-0 items-center gap-2">
                        {run.tireIndicator ? (
                          <TireIndicatorIcon indicator={run.tireIndicator} well />
                        ) : null}
                        {run.carId ? (
                          <button
                            type="button"
                            onClick={() => void openSetupForRun(run.id)}
                            disabled={setupLoadingRunId === run.id}
                            aria-label="View setup"
                            title="View setup sheet and what changed for this run"
                            className={cn(
                              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground transition hover:bg-muted/80",
                              setupLoadingRunId === run.id && "animate-pulse opacity-60"
                            )}
                          >
                            <Wrench className="h-4 w-4" aria-hidden />
                          </button>
                        ) : null}
                      </span>
                    </div>
                    {setupError && openId === run.id ? (
                      <p className="text-[11px] text-destructive">{setupError}</p>
                    ) : null}
                  </div>
              </Collapse>
            </div>
          );
        })}
      </div>

      {setupModal ? (
        <SetupSheetModal
          open
          onClose={() => setSetupModal(null)}
          run={setupModal.run}
          pickerRuns={setupModal.pickerRuns}
        />
      ) : null}
    </CardPanel>
  );
}
