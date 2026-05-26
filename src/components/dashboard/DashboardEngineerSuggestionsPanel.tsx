"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DashboardEngineerSuggestionPayloadV1 } from "@/lib/engineerPhase5/dashboardSuggestions/dashboardSuggestionTypes";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";

function isHydratedFromSsr(
  runId: string,
  initialSuggestions: DashboardEngineerSuggestionPayloadV1 | null | undefined
): initialSuggestions is DashboardEngineerSuggestionPayloadV1 {
  return (
    initialSuggestions != null &&
    typeof initialSuggestions.primaryRunId === "string" &&
    initialSuggestions.primaryRunId === runId
  );
}

export function DashboardEngineerSuggestionsPanel({
  runId,
  initialSuggestions,
}: {
  runId: string;
  /** SSR peek payload when fingerprint matches; `null` means “no cache yet — sync fetch”. */
  initialSuggestions?: DashboardEngineerSuggestionPayloadV1 | null;
}) {
  const hydrated = isHydratedFromSsr(runId, initialSuggestions);
  const [suggestions, setSuggestions] = useState<DashboardEngineerSuggestionPayloadV1 | null>(() =>
    hydrated ? initialSuggestions : null
  );
  const [loading, setLoading] = useState(() => !hydrated);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (isHydratedFromSsr(runId, initialSuggestions)) {
      setSuggestions(initialSuggestions);
      setLoading(false);
      setErr(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setErr(null);
    const qs = new URLSearchParams();
    qs.set("runId", runId);
    void fetch(`/api/engineer/dashboard-suggestions?${qs}`)
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          suggestions?: DashboardEngineerSuggestionPayloadV1 | null;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setErr(data.error ?? `Request failed (${res.status})`);
          setSuggestions(null);
          return;
        }
        setSuggestions(data.suggestions ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setErr("Could not load suggestions");
          setSuggestions(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId, initialSuggestions]);

  if (loading) {
    return <p className="text-[11px] text-muted-foreground">Loading engineer suggestions…</p>;
  }
  if (err) {
    return <p className="text-[11px] text-destructive">{err}</p>;
  }
  if (!suggestions) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Suggestions need a car on the run and completed logging. Edit the run if something is missing.
      </p>
    );
  }

  return (
    <div className="space-y-2 text-[11px] leading-snug">
      <p className="font-medium text-foreground">{suggestions.headline}</p>
      <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
        {suggestions.bullets.map((b, i) => (
          <li key={i} className="break-words">
            {b}
          </li>
        ))}
      </ul>
      {suggestions.tryNextSession.length > 0 ? (
        <div className="rounded-md border border-border/80 bg-muted/30 px-2 py-1.5">
          <div className="ui-title text-[10px] text-muted-foreground mb-1">Next session</div>
          <ul className="list-decimal space-y-0.5 pl-4 text-muted-foreground">
            {suggestions.tryNextSession.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-[10px] text-muted-foreground">{suggestions.sourcesNote}</p>
      <Link href={suggestions.engineerHref} className={buttonLinkClassName("outline", "text-muted-foreground hover:text-foreground")}>
        Open in Engineer
      </Link>
    </div>
  );
}
