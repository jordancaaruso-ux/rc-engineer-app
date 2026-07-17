"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Plus } from "lucide-react";
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
 * Design locked 2026-07-17 via 4-round founder interview (artifact board):
 * two-deck yellow bar — uppercase micro date label riding above a 20px Sora
 * headline, a −21° notch baseline-aligned to the headline's cap height (0.76em,
 * measured Sora 700 metrics), arrow right. No icon disc, square corners.
 * Founder-tuned numbers: headline 20px · notch→text gap 8px · notch width 6.5px.
 *
 * Draft-aware, mirroring the dock's Log-run circle: with an unfinished run today
 * the headline flips to "Finish today's run" (→ the draft), the micro label shows
 * the save time (wording-only tell — notch stays dark), and a quiet outlined
 * "Start a new run instead" appears beneath, so both paths stay one tap.
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

  // Device-local "WEDNESDAY · JULY 16" for the micro label. Computed once per
  // mount; SSR may render the server's date, so hydration warnings are
  // suppressed on the label (only ever differs across a midnight boundary).
  const [todayLabel] = useState(() => {
    const now = new Date();
    const weekday = new Intl.DateTimeFormat("en-AU", { weekday: "long" }).format(now);
    const month = new Intl.DateTimeFormat("en-AU", { month: "long" }).format(now);
    return `${weekday} · ${month} ${now.getDate()}`;
  });

  return (
    <div>
      <Link
        href={primaryHref}
        prefetch
        aria-label={hasDraft ? "Finish today's run" : "Start a new run"}
        className="tap-active logrun-glow relative isolate flex w-full items-center gap-3.5 overflow-visible rounded-2xl bg-primary px-[18px] pb-4 pt-[15px] text-left text-primary-foreground shadow-[0_10px_26px_-12px_rgba(255,214,10,0.55),inset_0_1px_0_rgba(255,255,255,0.35)] transition hover:brightness-105 active:brightness-95"
      >
        {/* Moving-hotspot face layer — drifts behind the content, clipped to the
            bar shape; the aura ring on ::after still radiates outward. */}
        <span className="logrun-fx" aria-hidden />
        <span className="relative z-[2] min-w-0">
          {/* Micro label — indented by notch width + gap (6.5 + 8) so it sits on
              the headline text's left edge. */}
          <span
            suppressHydrationWarning
            className="ml-[14.5px] block text-[10.5px] font-bold uppercase tracking-[0.09em] text-[rgba(18,17,16,0.55)] tabular-nums"
          >
            {hasDraft && todayDraftSavedAt ? (
              <>
                Saved{" "}
                <RelativeTime
                  iso={todayDraftSavedAt}
                  fallback={formatAppTimestampUtc(todayDraftSavedAt)}
                  className="text-[10.5px] text-[rgba(18,17,16,0.55)]"
                />
              </>
            ) : (
              todayLabel
            )}
          </span>
          <span className="mt-[3px] block whitespace-nowrap text-[20px] font-bold leading-[1.2] tracking-[-0.02em]">
            {/* Sector notch — baseline-aligned; 0.76em = Sora 700 cap height, so
                its top meets the S and its bottom sits on the baseline. */}
            <span
              aria-hidden
              className="mr-2 inline-block h-[0.76em] w-[6.5px] -skew-x-[21deg] rounded-[1px] bg-[rgba(18,17,16,0.88)] align-baseline"
            />
            {hasDraft ? "Finish today's run" : "Start a new run"}
          </span>
        </span>
        <ArrowRight aria-hidden className="relative z-[2] ml-auto size-[21px] shrink-0 opacity-75" strokeWidth={2.4} />
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
