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
import { engineerQuotaNote } from "@/lib/aiUsage/engineerQuotaNote";

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
  const quotaNote = await engineerQuotaNote(user);

  return (
    <>
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Engineer</h1>
          <p className="page-subtitle">Setup guidance from your runs and knowledge base.</p>
        </div>
      </header>
      {/* The chat column's clamp lives HERE, not on the children that used to carry
          `mx-auto max-w-4xl lg:max-w-6xl` each. `.page-header` mirrors its next
          sibling's clamp to put the title on the card's left edge (globals.css,
          "Desktop page header"), and a clamp on a grandchild is invisible to it —
          the title floated 74px left of the chat panel. `engineer-wide` is the
          mirror key for the `lg:`-prefixed width, same role as `.dash-wide`. */}
      <section className="page-body engineer-wide flex min-h-0 max-w-4xl flex-1 flex-col pb-2 lg:max-w-6xl md:pb-0">
        {/* Quota meter (MONETISATION_NORTH_STAR.md Phase 2). In the body, not the subtitle —
            `.page-header .page-subtitle` is display:none globally. */}
        {quotaNote ? (
          <p className="mb-2 w-full text-center text-xs text-muted-foreground">
            {quotaNote}
          </p>
        ) : null}
        {hasAnyRun ? null : (
          <CardPanel className="mb-3 w-full">
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
