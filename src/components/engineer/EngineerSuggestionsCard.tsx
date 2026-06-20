"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DashboardEngineerSuggestionPayloadV1 } from "@/lib/engineerPhase5/dashboardSuggestions/dashboardSuggestionTypes";
import { ButtonLink, buttonLinkClassName, primaryButtonClassName } from "@/components/ui/ButtonLink";
import { HeroPanel } from "@/components/ui/HeroPanel";
import { SectionMetaInline, SectionTitle } from "@/components/ui/SectionTitle";
import { cn } from "@/lib/utils";

type Emphasis = "postRun" | "default";
type Layout = "embedded" | "standalone";

const DISMISS_KEY_PREFIX = "engineer-suggestions-dismiss:";

function isDismissed(runId: string): boolean {
  if (typeof sessionStorage === "undefined") return false;
  return sessionStorage.getItem(`${DISMISS_KEY_PREFIX}${runId}`) === "1";
}

function dismissRun(runId: string): void {
  sessionStorage.setItem(`${DISMISS_KEY_PREFIX}${runId}`, "1");
}

type PeekResponse = {
  suggestions?: DashboardEngineerSuggestionPayloadV1 | null;
  runId?: string | null;
  cached?: boolean;
  error?: string;
};

function SuggestionsReady({
  suggestions,
  engineerLinkLabel,
  showInlineEngineerLink = true,
}: {
  suggestions: DashboardEngineerSuggestionPayloadV1;
  engineerLinkLabel: string;
  showInlineEngineerLink?: boolean;
}) {
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
      {showInlineEngineerLink ? (
        <Link
          href={suggestions.engineerHref}
          className={buttonLinkClassName("outline", "text-muted-foreground hover:text-foreground")}
        >
          {engineerLinkLabel}
        </Link>
      ) : null}
    </div>
  );
}

function SuggestionsIdle({
  emphasis,
  generating,
  error,
  onGenerate,
  onDismiss,
}: {
  emphasis: Emphasis;
  generating: boolean;
  error: string | null;
  onGenerate: () => void;
  onDismiss?: () => void;
}) {
  const postRun = emphasis === "postRun";
  return (
    <div className="space-y-2.5 text-[11px] leading-snug">
      <p className={cn("text-muted-foreground", postRun && "text-foreground font-medium")}>
        {postRun
          ? "Run saved. Want Engineer suggestions for this session?"
          : "Get a short read on your last run — setup moves, handling, and what to try next."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={cn(primaryButtonClassName(), "tap-active disabled:opacity-60")}
          disabled={generating}
          onClick={onGenerate}
        >
          {generating ? "Generating…" : "Get suggestions"}
        </button>
        {postRun && onDismiss ? (
          <button
            type="button"
            className="tap-active text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            disabled={generating}
            onClick={onDismiss}
          >
            Not now
          </button>
        ) : null}
      </div>
      <p className="text-[10px] text-muted-foreground">Uses AI. Generated only when you ask.</p>
      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
    </div>
  );
}

export function EngineerSuggestionsCard({
  runId: runIdProp,
  useLatest = false,
  emphasis = "default",
  scopeLine,
  layout = "embedded",
  className,
  onClearPostRunPrompt,
}: {
  /** Explicit run to peek / generate for. */
  runId?: string;
  /** When true and `runId` is absent, resolve latest eligible run via peek-only API. */
  useLatest?: boolean;
  emphasis?: Emphasis;
  scopeLine?: string;
  layout?: Layout;
  className?: string;
  /** Called when user taps Get suggestions or Not now (post-run prompt cleanup). */
  onClearPostRunPrompt?: () => void;
}) {
  const router = useRouter();
  const [resolvedRunId, setResolvedRunId] = useState<string | null>(runIdProp ?? null);
  const [suggestions, setSuggestions] = useState<DashboardEngineerSuggestionPayloadV1 | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [resolved, setResolved] = useState(Boolean(runIdProp));

  const effectiveEmphasis =
    emphasis === "postRun" && resolvedRunId && isDismissed(resolvedRunId) ? "default" : emphasis;

  const peek = useCallback(async () => {
    const qs = new URLSearchParams();
    if (runIdProp) qs.set("runId", runIdProp);
    else if (useLatest) qs.set("latest", "1");
    else return;

    try {
      const res = await fetch(`/api/engineer/dashboard-suggestions?${qs.toString()}`);
      const data = (await res.json().catch(() => ({}))) as PeekResponse;
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        setResolved(true);
        return;
      }
      const id = data.runId ?? runIdProp ?? null;
      if (!id) {
        setHidden(true);
        setResolved(true);
        return;
      }
      setResolvedRunId(id);
      setSuggestions(data.suggestions ?? null);
      setError(null);
      setResolved(true);
    } catch {
      setError("Could not load suggestions");
      setResolved(true);
    }
  }, [runIdProp, useLatest]);

  useEffect(() => {
    setResolvedRunId(runIdProp ?? null);
    setSuggestions(null);
    setError(null);
    setHidden(false);
    setResolved(Boolean(runIdProp));
    void peek();
  }, [runIdProp, useLatest, peek]);

  const generate = useCallback(async () => {
    const id = resolvedRunId ?? runIdProp;
    if (!id) return;
    setGenerating(true);
    setError(null);
    onClearPostRunPrompt?.();
    try {
      const qs = new URLSearchParams({ runId: id, sync: "1" });
      const res = await fetch(`/api/engineer/dashboard-suggestions?${qs.toString()}`);
      const data = (await res.json().catch(() => ({}))) as PeekResponse;
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setSuggestions(data.suggestions ?? null);
      if (!data.suggestions) {
        setError("Suggestions need a car on the run and completed logging.");
      }
    } catch {
      setError("Could not generate suggestions");
    } finally {
      setGenerating(false);
    }
  }, [resolvedRunId, runIdProp, onClearPostRunPrompt]);

  const handleDismiss = useCallback(() => {
    const id = resolvedRunId ?? runIdProp;
    if (id) dismissRun(id);
    onClearPostRunPrompt?.();
    router.replace("/", { scroll: false });
  }, [resolvedRunId, runIdProp, onClearPostRunPrompt, router]);

  if (hidden) return null;
  if (!resolvedRunId && !runIdProp && useLatest && !resolved) return null;

  const engineerLinkLabel = layout === "standalone" ? "Focus in Engineer" : "Open in Engineer";

  const body = suggestions ? (
    <SuggestionsReady
      suggestions={suggestions}
      engineerLinkLabel={engineerLinkLabel}
      showInlineEngineerLink={layout !== "standalone"}
    />
  ) : (
    <SuggestionsIdle
      emphasis={effectiveEmphasis}
      generating={generating}
      error={error}
      onGenerate={() => void generate()}
      onDismiss={effectiveEmphasis === "postRun" ? handleDismiss : undefined}
    />
  );

  if (layout === "standalone") {
    if (!resolved && useLatest && !runIdProp) return null;
    if (!resolvedRunId && !runIdProp) return null;

    return (
      <HeroPanel
        className={cn(
          effectiveEmphasis === "postRun" && !suggestions && "ring-1 ring-primary/30",
          className
        )}
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <SectionTitle as="div" className="text-sm">
                Engineer suggestions
              </SectionTitle>
              {scopeLine ? <SectionMetaInline>{scopeLine}</SectionMetaInline> : null}
            </div>
            {body}
          </div>
          {suggestions ? (
            <ButtonLink href={suggestions.engineerHref} variant="outline" className="shrink-0 self-start">
              {engineerLinkLabel}
            </ButtonLink>
          ) : null}
        </div>
      </HeroPanel>
    );
  }

  return (
    <div
      className={cn(
        effectiveEmphasis === "postRun" && !suggestions && "rounded-lg ring-1 ring-inset ring-primary/30",
        className
      )}
    >
      {body}
    </div>
  );
}
