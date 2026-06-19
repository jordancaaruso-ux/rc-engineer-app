"use client";

import { useEffect, useTransition, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EngineerCompareAndPattern } from "@/components/engineer/EngineerCompareLazy";
import { EngineerChatPanel } from "@/components/engineer/EngineerChatPanel";
import { persistEngineerSessionsTargetRunId } from "@/lib/engineerSessionsTargetStorage";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { Eyebrow } from "@/components/ui/panel";
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
      <SurfaceCard variant="panel" contentClassName="flex gap-1 p-1">
        <button
          type="button"
          className={cn(
            "tap-active flex-1 rounded-lg px-3 py-2 text-sm font-medium transition",
            mainTab === "chat" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => selectTab("chat")}
        >
          Chat
        </button>
        <button
          type="button"
          className={cn(
            "tap-active flex-1 rounded-lg px-3 py-2 text-sm font-medium transition",
            mainTab === "compare" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => selectTab("compare")}
        >
          Compare &amp; trend
        </button>
      </SurfaceCard>

      {mainTab === "chat" ? (
        <SurfaceCard variant="panel" overflowHidden={false} contentClassName={cn("p-0", isPending && "opacity-90")}>
          <div className="border-b border-border/80 px-4 py-3 md:px-5">
            <Eyebrow dot="accent">Ask the Engineer</Eyebrow>
            <p className="text-[11px] text-muted-foreground leading-snug mt-1.5">
              Grounded in your KB and recent runs.
            </p>
          </div>
          <EngineerChatPanel />
        </SurfaceCard>
      ) : (
        <section className={cn(isPending && "opacity-90")}>
          <EngineerCompareAndPattern />
        </section>
      )}
    </div>
  );
}
