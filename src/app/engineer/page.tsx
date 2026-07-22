import type { ReactNode } from "react";
import { Suspense } from "react";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { EngineerPageClient } from "@/components/engineer/EngineerPageClientLazy";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
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
  // The chat answers fine with an empty run log, so nothing here was broken —
  // but a first-time user burned a request to discover the tool only gets good
  // once it has their runs to read. Say so before they type (2026-07-22).
  const hasAnyRun = (await prisma.run.findFirst({ where: { userId: user.id }, select: { id: true } })) != null;

  return (
    <>
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Engineer</h1>
          <p className="page-subtitle">Setup guidance from your runs and knowledge base.</p>
        </div>
      </header>
      <section className="page-body flex min-h-0 flex-1 flex-col pb-2 md:pb-0">
        {hasAnyRun ? null : (
          <CardPanel className="mx-auto mb-3 w-full max-w-4xl">
            <Eyebrow>Before you ask</Eyebrow>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              The Engineer is at its best reading <span className="text-foreground">your</span> runs —
              what you changed, how the car felt, what the laps did. With none logged yet it can only
              answer in general terms.
            </p>
            <ButtonLink href="/runs/new" className="mt-4 px-3 py-2 text-[13px]">
              Log your first run
            </ButtonLink>
          </CardPanel>
        )}
        <Suspense fallback={<EngineerClientSkeleton />}>
          <EngineerPageClient ratingsEnabled={ratingsEnabled} />
        </Suspense>
      </section>
    </>
  );
}
