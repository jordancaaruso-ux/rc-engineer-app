"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EngineerChatPanel, type EngineerQueuedChatPrompt } from "@/components/engineer/EngineerChatPanel";
import { persistEngineerSessionsTargetRunId } from "@/lib/engineerSessionsTargetStorage";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { PanelSubtitle } from "@/components/ui/panel";

export function EngineerPageClient({ ratingsEnabled = false }: { ratingsEnabled?: boolean }) {
  const searchParams = useSearchParams();
  const promptParam = searchParams.get("prompt")?.trim() || "";
  const [promptConsumed, setPromptConsumed] = useState(false);

  const queuedPrompt: EngineerQueuedChatPrompt | null = useMemo(() => {
    if (!promptParam || promptConsumed) return null;
    return { id: promptParam.length, text: promptParam };
  }, [promptParam, promptConsumed]);

  useEffect(() => {
    const runId = searchParams.get("runId")?.trim();
    if (runId) persistEngineerSessionsTargetRunId(runId);
  }, [searchParams]);

  useEffect(() => {
    setPromptConsumed(false);
  }, [promptParam]);

  return (
    <div className="max-w-4xl mx-auto w-full space-y-3">
      <SurfaceCard variant="panel" overflowHidden={false} contentClassName="p-0">
        <div className="border-b border-border/80 px-4 py-3 md:px-5">
          <PanelSubtitle>Uses your setups and recent runs.</PanelSubtitle>
        </div>
        <EngineerChatPanel
          ratingsEnabled={ratingsEnabled}
          queuedPrompt={queuedPrompt}
          onQueuedPromptConsumed={() => setPromptConsumed(true)}
        />
      </SurfaceCard>
    </div>
  );
}
