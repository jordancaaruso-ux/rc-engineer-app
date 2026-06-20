import type { ReactNode } from "react";
import { Suspense } from "react";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { EngineerPageClient } from "@/components/engineer/EngineerPageClient";
import { CardPanel } from "@/components/ui/CardPanel";
import { isAuthAdminEmail } from "@/lib/authAdmin";

function EngineerClientSkeleton() {
  return (
    <CardPanel className="max-w-4xl mx-auto w-full" contentClassName="p-0">
      <div className="animate-pulse border-b border-border px-4 py-3">
        <div className="h-4 w-32 rounded-md bg-muted/60" />
      </div>
      <div className="space-y-3 p-4">
        <div className="h-10 w-full rounded-lg bg-muted/60" />
        <div className="h-48 w-full rounded-lg bg-muted/60" />
      </div>
    </CardPanel>
  );
}

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

  const user = await requireCurrentUser();
  const ratingsEnabled = isAuthAdminEmail(user.email);

  return (
    <>
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Engineer</h1>
          <p className="page-subtitle">Setup guidance from your runs and knowledge base.</p>
        </div>
      </header>
      <section className="page-body flex min-h-0 flex-1 flex-col pb-2 md:pb-0">
        <Suspense fallback={<EngineerClientSkeleton />}>
          <EngineerPageClient ratingsEnabled={ratingsEnabled} />
        </Suspense>
      </section>
    </>
  );
}
