"use client";

import { useSearchParams } from "next/navigation";
import { EngineerQuickFixButton } from "@/components/engineer/EngineerQuickFixButton";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

/**
 * Engineer page quick-fix strip when URL has a focused `runId`.
 */
export function EngineerQuickFixStrip({ className }: { className?: string }) {
  const searchParams = useSearchParams();
  const runId = searchParams.get("runId")?.trim() || "";

  if (!runId) return null;

  return (
    <CardPanel className={cn(className)}>
      <Eyebrow dot="muted">Quick fix</Eyebrow>
      <div className="mt-1.5">
        <EngineerQuickFixButton runId={runId} />
      </div>
    </CardPanel>
  );
}
