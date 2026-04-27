"use client";

import Link from "next/link";
import { useState } from "react";
import { formatLap } from "@/lib/runLaps";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import type { DashboardHomeModel } from "@/lib/dashboardServer";

type Props = {
  todayBestLap: number | null;
  todayBestAvgTop5: number | null;
  todayBestRunId: string | null;
  todayBestRunLabel: string | null;
  todayRunCount: number;
  todaysChanges: DashboardHomeModel["todaysChanges"];
  displayTimeZone: string;
};

type Tab = "best" | "changes";

export function TodaySummaryCard({
  todayBestLap,
  todayBestAvgTop5,
  todayBestRunId,
  todayBestRunLabel,
  todayRunCount,
  todaysChanges,
  displayTimeZone,
}: Props) {
  const [tab, setTab] = useState<Tab>("best");
  const totalChanges = todaysChanges.reduce((acc, block) => acc + block.rows.length, 0);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm shadow-black/25">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Today</div>
        <div className="text-[10px] text-muted-foreground">
          {todayRunCount === 0
            ? "No runs yet"
            : `${todayRunCount} run${todayRunCount === 1 ? "" : "s"} logged today`}
        </div>
      </div>

      <div
        className="flex border-b border-border/70 px-3"
        role="tablist"
        aria-label="Today summary tabs"
      >
        <TabButton id="best" active={tab === "best"} onClick={() => setTab("best")}>
          Best
        </TabButton>
        <TabButton id="changes" active={tab === "changes"} onClick={() => setTab("changes")}>
          Changes today
          {totalChanges > 0 ? (
            <span className="ml-1.5 inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:text-amber-300">
              {totalChanges}
            </span>
          ) : null}
        </TabButton>
      </div>

      <div className="p-3">
        {tab === "best" ? (
          <TodayBestPanel
            todayBestLap={todayBestLap}
            todayBestAvgTop5={todayBestAvgTop5}
            todayBestRunId={todayBestRunId}
            todayBestRunLabel={todayBestRunLabel}
          />
        ) : (
          <TodayChangesPanel blocks={todaysChanges} displayTimeZone={displayTimeZone} />
        )}
      </div>
    </div>
  );
}

function TabButton({
  id,
  active,
  onClick,
  children,
}: {
  id: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={`today-tab-${id}`}
      onClick={onClick}
      className={`-mb-px flex items-center gap-1 border-b-2 px-2 py-1.5 text-xs font-medium transition ${
        active
          ? "border-accent text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function TodayBestPanel({
  todayBestLap,
  todayBestAvgTop5,
  todayBestRunId,
  todayBestRunLabel,
}: Pick<Props, "todayBestLap" | "todayBestAvgTop5" | "todayBestRunId" | "todayBestRunLabel">) {
  if (todayBestLap == null) {
    return (
      <p className="text-[11px] text-muted-foreground">
        No laps logged yet today. Save a run to populate today&apos;s best.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-1">
      <div>
        <div className="text-[10px] font-medium text-muted-foreground">Best lap</div>
        <div className="font-mono text-sm tabular-nums text-foreground">{formatLap(todayBestLap)}</div>
      </div>
      <div>
        <div className="text-[10px] font-medium text-muted-foreground">Best avg top 5</div>
        <div className="font-mono text-sm tabular-nums text-foreground">{formatLap(todayBestAvgTop5)}</div>
      </div>
      <div className="min-w-0 flex-1 basis-full sm:basis-auto">
        <div className="text-[10px] font-medium text-muted-foreground">Best run</div>
        <div className="min-w-0 truncate text-[11px] text-foreground">
          {todayBestRunId ? (
            <Link
              href={`/runs/history?focusRun=${encodeURIComponent(todayBestRunId)}`}
              className="underline decoration-border underline-offset-2 hover:decoration-accent"
            >
              {todayBestRunLabel ?? "Open run"}
            </Link>
          ) : (
            todayBestRunLabel ?? "—"
          )}
        </div>
      </div>
    </div>
  );
}

function TodayChangesPanel({
  blocks,
  displayTimeZone,
}: {
  blocks: DashboardHomeModel["todaysChanges"];
  displayTimeZone: string;
}) {
  if (blocks.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        No setup changes between today&apos;s runs yet — each run inherits the last snapshot until you
        edit the sheet.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {blocks.map((block) => (
        <div key={block.runId} className="rounded-md border border-border bg-muted/40 p-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <Link
                href={`/runs/${encodeURIComponent(block.runId)}/edit`}
                className="text-[11px] font-medium text-foreground underline decoration-border underline-offset-2 hover:decoration-accent"
              >
                {block.runLabel}
              </Link>
              <div className="text-[10px] tabular-nums text-muted-foreground">
                {formatRunCreatedAtDateTime(block.when, displayTimeZone)}
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground">
              {block.rows.length} change{block.rows.length === 1 ? "" : "s"}
            </div>
          </div>
          <ul className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-0.5 text-[11px] sm:grid-cols-2">
            {block.rows.map((r) => (
              <li key={r.key} className="flex flex-wrap items-baseline gap-1">
                <span className="truncate font-medium text-foreground">{r.label}</span>
                {r.unit ? <span className="text-[10px] text-muted-foreground">({r.unit})</span> : null}
                <span className="ml-auto font-mono tabular-nums text-muted-foreground">
                  <span className="line-through opacity-70">{r.previous ?? "—"}</span>
                  <span className="mx-1 text-foreground/60">→</span>
                  <span className="font-semibold text-foreground">{r.current || "—"}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
