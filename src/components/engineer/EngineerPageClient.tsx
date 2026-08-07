"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EngineerChatPanel, type EngineerQueuedChatPrompt } from "@/components/engineer/EngineerChatPanel";
import { persistEngineerSessionsTargetRunId } from "@/lib/engineerSessionsTargetStorage";
import { SurfaceCard } from "@/components/ui/SurfaceCard";

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
    /* Wider at lg: the panel becomes two columns there (history rail + chat), so 4xl would leave
       the conversation itself in a ~576px gutter — narrower than it is on the phone-width layout. */
    <div className="max-w-4xl lg:max-w-6xl mx-auto w-full space-y-3">
      <SurfaceCard variant="panel" overflowHidden={false} contentClassName="p-0">
        <EngineerChatPanel
          ratingsEnabled={ratingsEnabled}
          queuedPrompt={queuedPrompt}
          onQueuedPromptConsumed={() => setPromptConsumed(true)}
        />
      </SurfaceCard>
    </div>
  );
}
