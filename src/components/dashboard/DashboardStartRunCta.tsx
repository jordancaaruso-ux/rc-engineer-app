"use client";

import Link from "next/link";
import { ChevronRight, Flag, Plus } from "lucide-react";
import { useTodayDraftRun } from "@/components/layout/TodayDraftRunProvider";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { formatAppTimestampUtc } from "@/lib/formatDate";

/**
 * The dashboard's primary action, pinned to the very top of the page body — the
 * single unmissable "start a run" entry point. New users kept hunting for where
 * to log a run because the only entry was the floating dock circle (icon-only);
 * this restores a loud, always-present dashboard CTA (2026-07-16, founder — the
 * hero log button retired on 2026-07-06 came back, better).
 *
 * Draft-aware, mirroring the dock's Log-run circle: with an unfinished run today
 * the primary flips to "Finish today's run" (→ the draft) and a quiet outlined
 * "Start a new run instead" appears beneath, so both paths stay one tap. This CTA
 * now owns the finish-draft nudge that `DashboardTodayStrip` used to carry.
 */
export function DashboardStartRunCta({
  serverDraftRunId,
  serverDraftSavedAt,
}: {
  serverDraftRunId: string | null;
  serverDraftSavedAt: string | null;
}) {
  const { draftRunId, draftSavedAt } = useTodayDraftRun();
  const todayDraftRunId = draftRunId ?? serverDraftRunId;
  const todayDraftSavedAt = draftSavedAt ?? serverDraftSavedAt;

  const hasDraft = Boolean(todayDraftRunId);
  const primaryHref = hasDraft
    ? `/runs/${encodeURIComponent(todayDraftRunId as string)}/edit`
    : "/runs/new";

  return (
    <div>
      <Link
        href={primaryHref}
        prefetch
        aria-label={hasDraft ? "Finish today's run" : "Start a new run"}
        className="tap-active logrun-glow relative isolate flex w-full items-center gap-3 overflow-visible rounded-2xl bg-primary px-4 py-4 text-left text-primary-foreground shadow-[0_10px_26px_-12px_rgba(255,214,10,0.55),inset_0_1px_0_rgba(255,255,255,0.35)] transition hover:brightness-105 active:brightness-95"
      >
        {/* Moving-hotspot face layer — drifts behind the content, clipped to the
            bar shape; the aura ring on ::after still radiates outward. */}
        <span className="logrun-fx" aria-hidden />
        <span
          aria-hidden
          className="relative z-[2] grid size-[30px] shrink-0 place-items-center rounded-full bg-[rgba(18,17,16,0.14)]"
        >
          {hasDraft ? <Flag className="size-4" /> : <Plus className="size-[18px]" strokeWidth={2.6} />}
        </span>
        <span className="relative z-[2] min-w-0">
          <span className="block text-[16px] font-bold tracking-tight">
            {hasDraft ? "Finish today's run" : "Start a new run"}
          </span>
          {hasDraft && todayDraftSavedAt ? (
            <span className="mt-0.5 block font-mono text-[10px] text-[rgba(18,17,16,0.62)]">
              Draft saved{" "}
              <RelativeTime
                iso={todayDraftSavedAt}
                fallback={formatAppTimestampUtc(todayDraftSavedAt)}
              />
            </span>
          ) : null}
        </span>
        <ChevronRight aria-hidden className="relative z-[2] ml-auto size-[18px] shrink-0 opacity-55" />
      </Link>

      {hasDraft ? (
        <Link
          href="/runs/new"
          prefetch
          className="tap-active mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-transparent px-4 py-3 text-[13.5px] font-semibold text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
        >
          <Plus aria-hidden className="size-[15px]" strokeWidth={2.2} />
          Start a new run instead
        </Link>
      ) : null}
    </div>
  );
}
