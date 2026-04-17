import type { ReactNode } from "react";
import { Suspense } from "react";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { EngineerPageClient } from "@/components/engineer/EngineerPageClient";

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

  await getOrCreateLocalUser();

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Engineer</h1>
          <p className="page-subtitle">
            Compare &amp; trend at the top (same run pair as Analysis), then ask the Engineer anything.
          </p>
        </div>
      </header>
      <section className="page-body flex flex-col h-full space-y-3">
        <Suspense
          fallback={
            <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm text-muted-foreground max-w-4xl mx-auto w-full">
              Loading…
            </div>
          }
        >
          <EngineerPageClient />
        </Suspense>
      </section>
    </>
  );
}
