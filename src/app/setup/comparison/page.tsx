import type { ReactNode } from "react";
import { Suspense } from "react";
import { hasDatabaseUrl } from "@/lib/env";
import { SetupComparisonClient } from "@/components/setup/SetupComparisonClient";
import { PageBackLink } from "@/components/ui/PageBackLink";

export default async function SetupComparisonPage(): Promise<ReactNode> {
  // Every setup on offer is read from the database — with no DB there is nothing to compare.
  const dbReady = hasDatabaseUrl();
  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/analysis" />
          <div>
            <h1 className="page-title">Setup comparison</h1>
            <p className="page-subtitle">Put two setups on one sheet and hold it to swap between them.</p>
          </div>
        </div>
      </header>
      <section className="page-body">
        <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
          <SetupComparisonClient dbReady={dbReady} />
        </Suspense>
      </section>
    </>
  );
}

