"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EngineerCompareAndPattern } from "@/components/engineer/EngineerCompareAndPattern";
import { EngineerChatPanel } from "@/components/engineer/EngineerChatPanel";
import { persistEngineerSessionsTargetRunId } from "@/lib/engineerSessionsTargetStorage";
import { EngineerBetweenRunHintsStrip } from "@/components/engineer/EngineerBetweenRunHintsStrip";
import { cn } from "@/lib/utils";

type EngineerMainTab = "chat" | "compare";

export function EngineerPageClient() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("engineerTab")?.trim();
  const [mainTab, setMainTab] = useState<EngineerMainTab>(() =>
    tabParam === "compare" ? "compare" : "chat"
  );

  useEffect(() => {
    if (tabParam === "compare") setMainTab("compare");
  }, [tabParam]);

  useEffect(() => {
    const runId = searchParams.get("runId")?.trim();
    if (runId) persistEngineerSessionsTargetRunId(runId);
  }, [searchParams]);

  return (
    <div className="max-w-4xl mx-auto w-full space-y-6">
      <EngineerBetweenRunHintsStrip />

      <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
        <button
          type="button"
          className={cn(
            "flex-1 rounded-md px-3 py-2 text-sm font-medium transition",
            mainTab === "chat" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setMainTab("chat")}
        >
          Chat
        </button>
        <button
          type="button"
          className={cn(
            "flex-1 rounded-md px-3 py-2 text-sm font-medium transition",
            mainTab === "compare" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setMainTab("compare")}
        >
          Compare &amp; trend
        </button>
      </div>

      {mainTab === "chat" ? (
        <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="border-b border-border bg-muted/25 px-4 py-3 md:px-5">
            <h2 className="text-lg font-semibold text-foreground tracking-tight">Ask the Engineer</h2>
            <p className="text-xs text-muted-foreground mt-1 leading-snug">
              Optional: set runs in <span className="font-medium text-foreground/90">Compare &amp; trend</span> so
              answers anchor to URL context.
            </p>
          </div>
          <div className="p-4 md:p-5">
            <EngineerChatPanel />
          </div>
        </section>
      ) : null}

      {mainTab === "compare" ? (
        <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="border-b border-border bg-muted/25 px-4 py-3 md:px-5">
            <h2 className="text-lg font-semibold text-foreground tracking-tight">Compare &amp; trend</h2>
            <p className="text-xs text-muted-foreground mt-1 leading-snug">
              Primary and compare runs use <span className="font-mono">runId</span> and{" "}
              <span className="font-mono">compareRunId</span> in the URL. Load a trend digest when you want a
              multi-session view for this car.
            </p>
          </div>
          <div className="p-4 md:p-5">
            <EngineerCompareAndPattern embedded />
          </div>
        </section>
      ) : null}
    </div>
  );
}
