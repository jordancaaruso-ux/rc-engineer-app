"use client";

import { useEffect, useTransition, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EngineerCompareAndPattern } from "@/components/engineer/EngineerCompareLazy";
import { EngineerChatPanel } from "@/components/engineer/EngineerChatPanel";
import { EngineerNavIcon } from "@/components/layout/EngineerNavIcon";
import { persistEngineerSessionsTargetRunId } from "@/lib/engineerSessionsTargetStorage";
import { EngineerSuggestionsStrip } from "@/components/engineer/EngineerSuggestionsStrip";
import { cn } from "@/lib/utils";

type EngineerMainTab = "chat" | "compare";

export function EngineerPageClient() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("engineerTab")?.trim();
  const [mainTab, setMainTab] = useState<EngineerMainTab>(() =>
    tabParam === "compare" ? "compare" : "chat"
  );
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (tabParam === "compare") setMainTab("compare");
  }, [tabParam]);

  useEffect(() => {
    const runId = searchParams.get("runId")?.trim();
    if (runId) persistEngineerSessionsTargetRunId(runId);
  }, [searchParams]);

  function selectTab(tab: EngineerMainTab) {
    startTransition(() => setMainTab(tab));
  }

  return (
    <div className="max-w-4xl mx-auto w-full space-y-6">
      <EngineerSuggestionsStrip />

      <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
        <button
          type="button"
          className={cn(
            "tap-active flex-1 rounded-md px-3 py-2 text-sm font-medium transition",
            mainTab === "chat" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => selectTab("chat")}
        >
          Chat
        </button>
        <button
          type="button"
          className={cn(
            "tap-active flex-1 rounded-md px-3 py-2 text-sm font-medium transition",
            mainTab === "compare" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => selectTab("compare")}
        >
          Compare &amp; trend
        </button>
      </div>

      {mainTab === "chat" ? (
        <section
          className={cn(
            "rounded-xl border border-border bg-card shadow-sm overflow-hidden",
            isPending && "opacity-90"
          )}
        >
          <div className="border-b border-border/80 px-4 py-2.5 md:px-5 flex items-center gap-2">
            <EngineerNavIcon className="[&_svg]:h-4 [&_svg]:w-4" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground tracking-tight">Ask the Engineer</h2>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Grounded in your KB and recent runs.
              </p>
            </div>
          </div>
          <EngineerChatPanel />
        </section>
      ) : (
        <section className={cn(isPending && "opacity-90")}>
          <EngineerCompareAndPattern />
        </section>
      )}
    </div>
  );
}
