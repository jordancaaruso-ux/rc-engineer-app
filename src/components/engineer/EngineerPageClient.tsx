"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { EngineerCompareAndPattern } from "@/components/engineer/EngineerCompareAndPattern";
import { EngineerChatPanel, type EngineerQueuedChatPrompt } from "@/components/engineer/EngineerChatPanel";
import type { PatternDigestV1 } from "@/lib/engineerPhase5/patternDigestTypes";
import { getEngineerQuickPromptById } from "@/lib/engineerQuickPrompts";
import { persistEngineerSessionsTargetRunId } from "@/lib/engineerSessionsTargetStorage";

import { EngineerBetweenRunHintsStrip } from "@/components/engineer/EngineerBetweenRunHintsStrip";

export function EngineerPageClient() {
  const [patternDigest, setPatternDigest] = useState<PatternDigestV1 | null>(null);
  const [includeRunCatalog, setIncludeRunCatalog] = useState(true);
  const [includePatternDigestInChat, setIncludePatternDigestInChat] = useState(false);
  const [queuedPrompt, setQueuedPrompt] = useState<EngineerQueuedChatPrompt | null>(null);

  useEffect(() => {
    if (!patternDigest) {
      setIncludePatternDigestInChat(false);
    }
  }, [patternDigest]);

  const queueEngineerPrompt = useCallback((text: string) => {
    setQueuedPrompt((prev) => ({ id: (prev?.id ?? 0) + 1, text }));
  }, []);

  const clearQueuedPrompt = useCallback(() => setQueuedPrompt(null), []);

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const autoPromptConsumedRef = useRef(false);

  useEffect(() => {
    if (autoPromptConsumedRef.current) return;
    const promptId = searchParams.get("engineerPrompt")?.trim();
    if (!promptId) return;
    const def = getEngineerQuickPromptById(promptId);
    if (!def) return;
    const runId = searchParams.get("runId")?.trim() || null;
    const compareRunId = searchParams.get("compareRunId")?.trim() || null;
    if (def.requiresRunId !== false && !runId) return;
    if (def.requiresCompare && !compareRunId) return;

    autoPromptConsumedRef.current = true;
    queueEngineerPrompt(def.prompt);

    // Strip the engineerPrompt param so a refresh does not re-submit the canned message.
    const next = new URLSearchParams(searchParams.toString());
    next.delete("engineerPrompt");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, pathname, router, queueEngineerPrompt]);

  useEffect(() => {
    const runId = searchParams.get("runId")?.trim();
    if (runId) persistEngineerSessionsTargetRunId(runId);
  }, [searchParams]);

  return (
    <div className="max-w-4xl mx-auto w-full space-y-6">
      <EngineerBetweenRunHintsStrip />

      <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="border-b border-border bg-muted/25 px-4 py-3 md:px-5">
          <h2 className="text-lg font-semibold text-foreground tracking-tight">Ask the Engineer</h2>
        </div>
        <div className="p-4 md:p-5">
          <EngineerChatPanel
            patternDigest={patternDigest}
            includeRunCatalog={includeRunCatalog}
            onIncludeRunCatalogChange={setIncludeRunCatalog}
            includePatternDigestInChat={includePatternDigestInChat}
            onIncludePatternDigestInChatChange={setIncludePatternDigestInChat}
            queuedPrompt={queuedPrompt}
            onQueuedPromptConsumed={clearQueuedPrompt}
            onQuickPrompt={queueEngineerPrompt}
          />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="border-b border-border bg-muted/25 px-4 py-3 md:px-5">
          <h2 className="text-lg font-semibold text-foreground tracking-tight">Compare &amp; trend</h2>
          <p className="text-xs text-muted-foreground mt-1 leading-snug">
            Choose target (primary) and comparison runs — same URL as Analysis &quot;Compare with Engineer&quot; (
            <span className="font-mono">runId</span> / <span className="font-mono">compareRunId</span>). Optional trend
            digest loads here; enable &quot;Attach Compare &amp; trend digest to chat&quot; above only when you want the
            series in the conversation.
          </p>
        </div>
        <div className="p-4 md:p-5">
          <EngineerCompareAndPattern
            embedded
            onDigestLoaded={setPatternDigest}
            showRunSummaryPanel
            onQueueEngineerChatPrompt={queueEngineerPrompt}
          />
        </div>
      </section>
    </div>
  );
}
