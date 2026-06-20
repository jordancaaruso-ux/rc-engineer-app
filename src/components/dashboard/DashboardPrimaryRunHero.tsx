"use client";

import Link from "next/link";
import { PlusCircle } from "lucide-react";
import { useTodayDraftRun } from "@/components/layout/TodayDraftRunProvider";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { Eyebrow, PanelSubtitle, PanelTitle } from "@/components/ui/panel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { formatAppTimestampUtc } from "@/lib/formatDate";

export function DashboardPrimaryRunHero({
  todayRunCount,
  serverDraftRunId,
  serverDraftSavedAt,
}: {
  todayRunCount: number;
  serverDraftRunId: string | null;
  serverDraftSavedAt: string | null;
}) {
  const { draftRunId, draftSavedAt } = useTodayDraftRun();
  const todayDraftRunId = draftRunId ?? serverDraftRunId;
  const todayDraftSavedAt = draftSavedAt ?? serverDraftSavedAt;

  const primaryAction = todayDraftRunId
    ? {
        href: `/runs/${encodeURIComponent(todayDraftRunId)}/edit`,
        label: "Complete logged run",
        blurb: "Finish the run you saved as a draft earlier.",
      }
    : {
        href: "/runs/new",
        label: "New run",
        meta: "Log a session on your car and track.",
      };

  const heroBlurb = "meta" in primaryAction ? primaryAction.meta : primaryAction.blurb;

  return (
    <SurfaceCard variant="hero">
      <Eyebrow dot="accent">
        {todayRunCount > 0
          ? `Today · ${todayRunCount} run${todayRunCount === 1 ? "" : "s"}`
          : "Today"}
      </Eyebrow>

      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {todayDraftRunId ? <Eyebrow dot="accent">Unfinished run</Eyebrow> : null}
          <PanelTitle as="h2" className="mt-1">
            {primaryAction.label}
          </PanelTitle>
          {heroBlurb ? <PanelSubtitle className="mt-1.5">{heroBlurb}</PanelSubtitle> : null}
          {todayDraftRunId && todayDraftSavedAt ? (
            <div className="mt-1.5 font-mono text-[10px] tabular-nums text-faint">
              Saved{" "}
              <RelativeTime
                iso={todayDraftSavedAt}
                fallback={formatAppTimestampUtc(todayDraftSavedAt)}
              />
            </div>
          ) : null}
        </div>

        <Link
          href={primaryAction.href}
          prefetch
          className={buttonLinkClassName(
            "primary",
            "primary-action-chip-prominent w-full shrink-0 sm:w-auto"
          )}
        >
          <span className="primary-action-chip-content">
            <span>{todayDraftRunId ? "Finish" : "Add"}</span>
            {todayDraftRunId ? (
              <span aria-hidden className="primary-action-chip-icon text-[13px]">
                →
              </span>
            ) : (
              <PlusCircle className="primary-action-chip-icon" strokeWidth={2} aria-hidden />
            )}
          </span>
        </Link>
      </div>
    </SurfaceCard>
  );
}
