import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { loadEngineerWorkflowContext } from "@/lib/workflowContext";
import { EngineerSummaryAndChat } from "@/components/engineer/EngineerSummaryAndChat";

export const dynamic = "force-dynamic";

export default async function EngineerChatPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Engineer</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
      </>
    );
  }

  const user = await getOrCreateLocalUser();
  const ctx = await loadEngineerWorkflowContext(user.id);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Engineer</h1>
          <p className="page-subtitle">Context → summary → follow-up questions (conservative by default).</p>
        </div>
      </header>
      <section className="page-body flex flex-col h-full space-y-3">
        <div className="rounded-lg border border-border bg-muted/50 p-3 text-xs space-y-2">
          <div className="ui-title text-[10px] uppercase tracking-wide text-muted-foreground">
            Workflow context
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Continuity only — your latest saved run and active &quot;things to try&quot; (same as the{" "}
            <Link href="/" className="text-accent underline">
              dashboard
            </Link>
            ). This is not automated judgment; the engineer stays conservative until you drive the conversation.
          </p>
          <div className="rounded-md border border-border bg-card/80 p-2.5 space-y-1.5">
            <div className="font-medium text-foreground text-[11px]">Latest run</div>
            {ctx.lastRun ? (
              <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc pl-4">
                <li>
                  {ctx.lastRun.createdAtLabel} · {ctx.lastRun.sessionSummary} · {ctx.lastRun.carName} ·{" "}
                  {ctx.lastRun.trackName}
                  {ctx.lastRun.eventName ? ` · ${ctx.lastRun.eventName}` : ""}
                </li>
                <li className="text-foreground/90 whitespace-pre-wrap break-words">Notes: {ctx.lastRun.notesPreview}</li>
              </ul>
            ) : (
              <p className="text-[11px] text-muted-foreground">No runs saved yet. Log a run to populate this.</p>
            )}
          </div>
          <div className="rounded-md border border-border bg-card/80 p-2.5 space-y-1.5">
            <div className="font-medium text-foreground text-[11px]">Things to try</div>
            {ctx.thingsToTry.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">None yet — add on the dashboard or in Log your run.</p>
            ) : (
              <ul className="space-y-1">
                {ctx.thingsToTry.map((i) => (
                  <li key={i.id} className="text-[11px] text-foreground pl-2 border-l-2 border-accent/40">
                    {i.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <Suspense
          fallback={
            <div className="rounded-lg border border-border bg-muted/50 p-3 text-[11px] text-muted-foreground">
              Loading engineer…
            </div>
          }
        >
          <EngineerSummaryAndChat />
        </Suspense>
      </section>
    </>
  );
}
