"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Trophy } from "lucide-react";
import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { recordMetricLabel, type DashboardNewPb } from "@/lib/dashboardRecords";
import { cn } from "@/lib/utils";
import { formatLap } from "@/lib/runLaps";
import { formatRunDateTime } from "@/lib/formatDate";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { CardPanel } from "@/components/ui/CardPanel";
import { PagedCard } from "@/components/ui/PagedCard";
import { RollingNumber } from "@/components/ui/motion";
import { Eyebrow, PanelSubtitle, PanelTitle, StatStrip, StatTile } from "@/components/ui/panel";

type RecentRun = NonNullable<DashboardHomeModel["recentRun"]>;

function formatCarRating(rating: number | null | undefined): string {
  if (typeof rating !== "number" || !Number.isFinite(rating) || rating < 1 || rating > 10) {
    return "—";
  }
  return `${Math.round(rating)}/10`;
}

/**
 * Last-run card — an Apple-widget-style paged card: swipe between the lap
 * numbers, the handling read, and what changed on the car vs the run before.
 * Every face taps through to the run in history; the dots switch faces.
 */
export function DashboardPreviousRunCard({
  recentRun,
  newPb,
  displayTimeZone,
}: {
  recentRun: DashboardHomeModel["recentRun"];
  /** Set when this run broke a record — surfaces the post-run PB celebration. */
  newPb: DashboardNewPb | null;
  displayTimeZone: string;
}) {
  const viewRunHref = recentRun
    ? `/runs/history?focusRun=${encodeURIComponent(recentRun.id)}`
    : null;
  const runLoggingComplete =
    Boolean(recentRun?.loggingCompletedAt) || recentRun?.loggingComplete === true;
  const formattedRunDate =
    recentRun
      ? formatRunDateTime(
          resolveRunDisplayInstant({
            createdAt: recentRun.createdAt,
            sessionCompletedAt: recentRun.sessionCompletedAt,
            loggingCompletedAt: recentRun.loggingCompletedAt,
          }),
          displayTimeZone
        )
      : null;

  if (!recentRun || !viewRunHref) {
    return (
      <CardPanel>
        <Eyebrow dot="muted">Last run</Eyebrow>
        <PanelSubtitle className="mt-1.5">No runs yet — log one to populate this.</PanelSubtitle>
      </CardPanel>
    );
  }

  const header = (
    <div className="space-y-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <PanelTitle as="h3" className="shrink-0">
          {recentRun.carName}
        </PanelTitle>
        <span className="min-w-0 truncate text-[13px] leading-relaxed text-muted-foreground">
          {recentRun.trackName ?? "No track"} · {recentRun.sessionLabel} · {formattedRunDate}
        </span>
      </div>
      {recentRun.eventName ? (
        <PanelSubtitle className="mt-0">{recentRun.eventName}</PanelSubtitle>
      ) : null}
    </div>
  );

  // Draft runs keep the simple single-face card — faces earn their keep once
  // logging is complete and laps / handling / setup changes actually exist.
  if (!runLoggingComplete) {
    return (
      <CardPanel className="relative">
        <Eyebrow dot="muted">Last run</Eyebrow>
        <Link
          href={viewRunHref}
          prefetch
          aria-label="View last run"
          className="tap-active absolute inset-0 z-0 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        <div className="pointer-events-none relative z-10 mt-1.5">{header}</div>
      </CardPanel>
    );
  }

  return (
    <CardPanel className="relative">
      <Eyebrow dot="muted">Last run</Eyebrow>
      {/* Header overlay link — the paged region below carries its own per-face links. */}
      <Link
        href={viewRunHref}
        prefetch
        aria-label="View last run"
        className="tap-active absolute inset-0 z-0 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      />
      <div className="pointer-events-none relative z-10 mt-1.5">
        {header}
        {newPb ? <PbFlag newPb={newPb} /> : null}
      </div>
      <div className="relative z-10">
        <PagedCard
          storageKey="dashboard-previous-run"
          faces={[
            {
              id: "laps",
              label: "Lap stats",
              shortLabel: "Laps",
              content: (
                <RunFace href={viewRunHref}>
                  <LapsFace run={recentRun} />
                </RunFace>
              ),
            },
            {
              id: "handling",
              label: "Handling read",
              shortLabel: "Handling",
              content: (
                <RunFace href={viewRunHref}>
                  <HandlingFace run={recentRun} />
                </RunFace>
              ),
            },
            {
              id: "setup-changes",
              label: "Setup changes",
              shortLabel: "Setup",
              content: (
                <RunFace href={viewRunHref}>
                  <SetupChangesFace run={recentRun} />
                </RunFace>
              ),
            },
          ]}
        />
      </div>
    </CardPanel>
  );
}

/** Post-run celebration pill — a record this run just broke. Green = pace win. */
function PbFlag({ newPb }: { newPb: DashboardNewPb }) {
  return (
    <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-[#4FD089]/12 px-2 py-1 text-[11px] font-medium text-[#4FD089]">
      <Trophy className="size-3.5 shrink-0" aria-hidden />
      New {recordMetricLabel(newPb.metric)} · {formatLap(newPb.value)}
    </div>
  );
}

/**
 * Face wrapper: the face body is inert to the pointer so the underlying link
 * takes the tap, while swipes still bubble to the pager viewport. A completed
 * swipe's trailing click is swallowed by the pager, so navigation only fires
 * on a genuine tap.
 */
function RunFace({ href, children }: { href: string; children: ReactNode }) {
  return (
    <div className="relative">
      <Link
        href={href}
        prefetch
        aria-label="View last run"
        className="tap-active absolute inset-0 z-0 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      />
      <div className="pointer-events-none relative z-10">{children}</div>
    </div>
  );
}

/** Face 1 — the numbers. Lap times roll in on mount; the lap count stays put. */
function LapsFace({ run }: { run: RecentRun }) {
  return (
    <StatStrip className="mt-2" gridClassName="grid-cols-3">
      <StatTile label="Best lap" value={<RollingLap seconds={run.bestLap} />} accent className="py-2" />
      <StatTile label="Avg top 5" value={<RollingLap seconds={run.avgTop5} />} className="py-2" />
      <StatTile label="Laps" value={String(run.lapCount)} className="py-2" />
    </StatStrip>
  );
}

/** A lap time that rolls to its value, or a static em-dash when there's no lap. */
function RollingLap({ seconds }: { seconds: number | null | undefined }) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return <>{formatLap(seconds ?? null)}</>;
  return <RollingNumber value={seconds} format={(n) => formatLap(n)} />;
}

/** How many handling read lines the face shows before truncating. */
const HANDLING_FACE_MAX_LINES = 4;

/** Face 2 — what the car felt like: rating plus the structured handling read. */
function HandlingFace({ run }: { run: RecentRun }) {
  const lines = run.handlingLines.slice(0, HANDLING_FACE_MAX_LINES);
  const hasAnything = lines.length > 0 || run.handlingProblems || run.carRating != null;
  return (
    <div className="mt-2 rounded-xl border border-border bg-background/45 px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="type-data-label">Handling</div>
        <div className="font-mono text-[13px] font-medium tabular-nums text-foreground">
          {formatCarRating(run.carRating)}
        </div>
      </div>
      {hasAnything ? (
        <>
          {lines.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {lines.map((line) => (
                <li key={line} className="text-[12px] leading-snug text-muted-foreground">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
          {run.handlingProblems ? (
            <p className="mt-2 line-clamp-2 text-[12px] leading-snug text-muted-foreground">
              {run.handlingProblems}
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
          No handling read logged for this run.
        </p>
      )}
    </div>
  );
}

/** How many changed parameters the face lists before the "+N more" line. */
const SETUP_FACE_MAX_ROWS = 4;

/** Face 3 — what changed on the car vs the run before it. */
function SetupChangesFace({ run }: { run: RecentRun }) {
  const changes = run.setupChanges;
  if (changes === null) {
    return (
      <FaceNote label="Setup changes">
        First logged run — no earlier setup to compare against.
      </FaceNote>
    );
  }
  if (changes.length === 0) {
    return <FaceNote label="Setup changes">No setup changes vs the previous run.</FaceNote>;
  }
  const rows = changes.slice(0, SETUP_FACE_MAX_ROWS);
  const moreCount = changes.length - rows.length;
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border bg-background/45">
      {rows.map((row, i) => (
        <div
          key={row.key}
          className={cn(
            "flex items-baseline justify-between gap-3 px-3.5 py-2",
            i > 0 && "border-t border-border"
          )}
        >
          <div className="type-data-label min-w-0 truncate">{row.label}</div>
          <div className="shrink-0 font-mono text-[12px] tabular-nums text-foreground">
            <span className="text-muted-foreground">{row.previous ?? "—"}</span>
            <span className="mx-1.5 text-muted-foreground">→</span>
            {row.current}
            {row.unit ? <span className="ml-1 text-muted-foreground">{row.unit}</span> : null}
          </div>
        </div>
      ))}
      {moreCount > 0 ? (
        <div className="border-t border-border px-3.5 py-1.5 text-[10px] leading-snug text-muted-foreground">
          +{moreCount} more change{moreCount === 1 ? "" : "s"}
        </div>
      ) : null}
    </div>
  );
}

/** Bordered face body for text-only states, matching the strip surfaces. */
function FaceNote({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-2 rounded-xl border border-border bg-background/45 px-3.5 py-3">
      <div className="type-data-label">{label}</div>
      <p className="mt-2 text-[12px] leading-snug text-muted-foreground">{children}</p>
    </div>
  );
}
