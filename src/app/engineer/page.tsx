import type { ReactNode } from "react";
import Link from "next/link";

export const dynamic = "force-dynamic";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { loadEngineerWorkflowContext } from "@/lib/workflowContext";

export default async function EngineerChatPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Engineer Chat</h1>
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
          <h1 className="page-title">Engineer Chat</h1>
          <p className="page-subtitle">
            Describe the handling and iterate with your AI race engineer.
          </p>
        </div>
      </header>
      <section className="page-body flex flex-col h-full space-y-3">
        <div className="rounded-lg border border-border bg-muted/50 p-3 text-xs space-y-2">
          <div className="ui-title text-[10px] uppercase tracking-wide text-muted-foreground">
            Workflow context
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Same data the app uses for decisions: your latest saved run and active &quot;things to try&quot; (also on the{" "}
            <Link href="/" className="text-accent underline">
              dashboard
            </Link>
            ).
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

        <div className="flex-1 rounded-lg border border-border bg-card p-4 mb-3 flex flex-col gap-3 text-sm">
          <div className="text-sm font-medium text-muted-foreground">Conversation</div>
          <div className="rounded-md border border-border bg-muted/60 p-3 text-xs text-muted-foreground">
            Engineer:
            <br />
            <span className="text-foreground">
              “Tell me what the car is doing in entry, mid, and exit. I’ll translate that into setup options.”
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 flex items-center gap-2">
          <input
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            placeholder="Describe the run, corner phases, and what you want to improve..."
          />
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground shadow-glow-sm hover:brightness-105 transition"
          >
            Send
          </button>
        </div>
      </section>
    </>
  );
}
