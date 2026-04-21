import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { hasDatabaseUrl } from "@/lib/env";
import { LapImportWorkspace } from "@/components/laps/LapImportWorkspace";

export default function LapTimeImportPage(): ReactNode {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Lap-time import</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
        <section className="page-body">
          <p className="text-sm text-muted-foreground">Set DATABASE_URL to use this feature.</p>
        </section>
      </>
    );
  }

  return (
    <>
      <header className="page-header">
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="page-title text-base">Lap-time import</h1>
            <p className="page-subtitle mt-0.5 max-w-xl text-[11px] leading-snug">
              Import timing URLs outside a run. Same parser as Log your run; sessions are saved for reuse and can link when you log a run.
            </p>
          </div>
          <Link
            href="/runs/new"
            className="shrink-0 rounded-lg border border-border bg-card/50 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
          >
            Log your run
          </Link>
        </div>
      </header>
      <section className="page-body">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <LapImportWorkspace />
        </Suspense>
      </section>
    </>
  );
}
