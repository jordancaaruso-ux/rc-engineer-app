"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ENGINEER_SESSIONS_TARGET_UPDATED_EVENT,
  persistEngineerSessionsTargetRunId,
  readEngineerSessionsTargetRunId,
} from "@/lib/engineerSessionsTargetStorage";
import { cn } from "@/lib/utils";

const linkBtnClass =
  "inline-flex items-center rounded-md border border-border bg-card/60 px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted/60 transition";

/**
 * Sessions expanded row: jump to Engineer with `runId` / `compareRunId` URL params
 * (no top “compare pair” bar). Target run is remembered for “Set comparison”.
 */
export function SessionsEngineerPairLinks({ runId }: { runId: string }) {
  const [targetFromStorage, setTargetFromStorage] = useState<string | null>(null);

  const syncFromStorage = useCallback(() => {
    setTargetFromStorage(readEngineerSessionsTargetRunId());
  }, []);

  useEffect(() => {
    syncFromStorage();
    window.addEventListener(ENGINEER_SESSIONS_TARGET_UPDATED_EVENT, syncFromStorage);
    return () => window.removeEventListener(ENGINEER_SESSIONS_TARGET_UPDATED_EVENT, syncFromStorage);
  }, [syncFromStorage]);

  const isTarget = targetFromStorage === runId;
  const comparisonHref =
    targetFromStorage && targetFromStorage !== runId
      ? `/engineer?runId=${encodeURIComponent(targetFromStorage)}&compareRunId=${encodeURIComponent(runId)}`
      : null;

  return (
    <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
      {isTarget ? (
        <span
          className="rounded border border-primary/40 bg-primary/10 px-2 py-1 text-[10px] ui-title text-foreground"
          title="Primary run for Engineer compare"
        >
          Target
        </span>
      ) : (
        <Link
          href={`/engineer?runId=${encodeURIComponent(runId)}`}
          className={linkBtnClass}
          onClick={() => persistEngineerSessionsTargetRunId(runId)}
        >
          Set target
        </Link>
      )}

      {comparisonHref ? (
        <Link href={comparisonHref} className={linkBtnClass}>
          Set comparison
        </Link>
      ) : (
        <span
          className={cn(
            "text-[10px] text-muted-foreground max-w-[14rem] leading-snug",
            !targetFromStorage && "italic"
          )}
          title={targetFromStorage ? undefined : "Choose Set target on a run first, then open another run here."}
        >
          {targetFromStorage
            ? targetFromStorage === runId
              ? "Comparison: pick a different run"
              : "Set comparison opens Engineer with both runs"
            : "Set comparison (after target)"}
        </span>
      )}
    </div>
  );
}
