"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EngineerChatPanel, type EngineerQueuedChatPrompt } from "@/components/engineer/EngineerChatPanel";

export function EngineerPageClient({
  ratingsEnabled = false,
  hasRuns = false,
}: {
  ratingsEnabled?: boolean;
  /** The driver has logged at least one run — decides which starter questions are offered. */
  hasRuns?: boolean;
}) {
  const searchParams = useSearchParams();
  const promptParam = searchParams.get("prompt")?.trim() || "";
  const [promptConsumed, setPromptConsumed] = useState(false);

  const queuedPrompt: EngineerQueuedChatPrompt | null = useMemo(() => {
    if (!promptParam || promptConsumed) return null;
    return { id: promptParam.length, text: promptParam };
  }, [promptParam, promptConsumed]);

  useEffect(() => {
    setPromptConsumed(false);
  }, [promptParam]);

  return (
    /* The clamp that used to be here (`max-w-4xl lg:max-w-6xl mx-auto` — wider at lg because the
       panel becomes two columns there, and 4xl would leave the conversation itself in a ~576px
       gutter) now lives on `.page-body` in app/engineer/page.tsx, so the page header can mirror it
       and the title lands on this panel's left edge. */
    /* The panel renders its OWN two cards (conversation + history), so there is no card wrapper
       here — one around both would put a border round the gap between them. */
    <div className="w-full space-y-3">
      <EngineerChatPanel
        ratingsEnabled={ratingsEnabled}
        hasRuns={hasRuns}
        queuedPrompt={queuedPrompt}
        onQueuedPromptConsumed={() => setPromptConsumed(true)}
      />
    </div>
  );
}
