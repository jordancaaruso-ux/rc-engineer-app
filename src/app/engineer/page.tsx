import type { ReactNode } from "react";
import { Suspense } from "react";
import { requireCurrentUser } from "@/lib/currentUser";
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

  await requireCurrentUser();

  return (
    <>
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Engineer</h1>
          <p className="page-subtitle mt-0.5">Setup guidance from your runs and knowledge base.</p>
        </div>
      </header>
      <section className="page-body flex min-h-0 flex-1 flex-col gap-4 pb-2 md:pb-0">
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
