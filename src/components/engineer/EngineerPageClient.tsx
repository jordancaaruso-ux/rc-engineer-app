"use client";

import { useState } from "react";
import { EngineerCompareAndPattern } from "@/components/engineer/EngineerCompareAndPattern";
import { EngineerLatestRunSummary } from "@/components/engineer/EngineerLatestRunSummary";
import { EngineerChatPanel } from "@/components/engineer/EngineerChatPanel";
import type { PatternDigestV1 } from "@/lib/engineerPhase5/patternDigestTypes";
import { cn } from "@/lib/utils";

export function EngineerPageClient() {
  const [patternDigest, setPatternDigest] = useState<PatternDigestV1 | null>(null);
  const [includeRunCatalog, setIncludeRunCatalog] = useState(true);

  return (
    <div className="max-w-4xl mx-auto w-full space-y-6">
      <EngineerLatestRunSummary />

      <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="border-b border-border bg-muted/25 px-4 py-3 md:px-5">
          <h2 className="text-lg font-semibold text-foreground tracking-tight">Ask the Engineer</h2>
          <p className="text-xs text-muted-foreground mt-1 leading-snug">
            Main workspace — questions about your data, setup, and laps. Uses your latest summary above, optional
            compare/digest from the section below, and the run catalog when enabled.
          </p>
        </div>
        <div className="p-4 md:p-5">
          <EngineerChatPanel
            patternDigest={patternDigest}
            includeRunCatalog={includeRunCatalog}
            onIncludeRunCatalogChange={setIncludeRunCatalog}
          />
        </div>
      </section>

      <details className="engineer-compare-details rounded-xl border border-border bg-muted/15 overflow-hidden open:shadow-sm">
        <style>{`
          .engineer-compare-details[open] .engineer-compare-chevron {
            transform: rotate(180deg);
          }
        `}</style>
        <summary
          className={cn(
            "cursor-pointer list-none px-4 py-3.5 md:px-5 flex items-center justify-between gap-3",
            "text-sm font-medium text-foreground hover:bg-muted/35 transition-colors",
            "[&::-webkit-details-marker]:hidden"
          )}
        >
          <span>Use engineer to compare runs</span>
          <span className="text-muted-foreground text-xs shrink-0 hidden sm:inline">
            Two-run compare · teammates · trend digest
          </span>
          <span
            className="engineer-compare-chevron text-muted-foreground text-lg leading-none shrink-0 transition-transform duration-200 inline-block"
            aria-hidden
          >
            ▼
          </span>
        </summary>
        <div className="border-t border-border bg-card/60 px-3 pb-4 pt-1 md:px-4">
          <EngineerCompareAndPattern embedded onDigestLoaded={setPatternDigest} />
        </div>
      </details>
    </div>
  );
}
