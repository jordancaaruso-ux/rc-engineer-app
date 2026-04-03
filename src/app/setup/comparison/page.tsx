import type { ReactNode } from "react";
import { Suspense } from "react";
import { hasDatabaseUrl } from "@/lib/env";
import { SetupComparisonClient } from "@/components/setup/SetupComparisonClient";

export default async function SetupComparisonPage(): Promise<ReactNode> {
  // Comparison can still work without DB for “current setup vs …”, but selectors need DB sources.
  const dbReady = hasDatabaseUrl();
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Setup comparison</h1>
          <p className="page-subtitle">Compare any two setups using graded differences.</p>
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

