import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { prisma } from "@/lib/prisma";
import { normalizeSetupData } from "@/lib/runSetup";
import { CardPanel } from "@/components/ui/CardPanel";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { loadBaselineEditorContext } from "@/lib/baselineSetups/loadBaselineEditorContext";
import type { BaselineSetupKindValue } from "@/lib/baselineSetups/baselineSetupShape";
import { BaselineSetupEditorClient } from "@/components/baselineSetups/BaselineSetupEditorClient";

/**
 * Admin-only: edit a published baseline. Copies drivers already made are untouched — they hold
 * their own values, and the lineage link is `onDelete: SetNull`.
 */
export default async function EditBaselineSetupPage({
  params,
}: {
  params: Promise<{ id: string; baselineId: string }>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <header className="page-header">
        <div>
          <h1 className="page-title">Baseline</h1>
          <p className="page-subtitle">Database not configured.</p>
        </div>
      </header>
    );
  }

  const user = await requireCurrentUser();
  if (!isAuthAdminEmail(user.email)) notFound();
  const { id, baselineId } = await params;

  const [ctx, baseline] = await Promise.all([
    loadBaselineEditorContext(id, { excludeBaselineId: baselineId }),
    prisma.baselineSetup.findFirst({
      where: { id: baselineId, setupSheetModelId: id },
      select: {
        id: true,
        name: true,
        kind: true,
        notes: true,
        surface: true,
        gripLevel: true,
        data: true,
      },
    }),
  ]);
  if (!ctx || !baseline) notFound();

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href={`/setup-sheet-models/${id}`} />
          <div className="min-w-0">
            <h1 className="page-title truncate">{baseline.name}</h1>
            <p className="page-subtitle truncate">{ctx.model.name}</p>
          </div>
        </div>
      </header>
      <section className="page-body">
        <div>
          {ctx.template ? (
            <BaselineSetupEditorClient
              modelId={ctx.model.id}
              modelName={ctx.model.name}
              template={ctx.template}
              baselineId={baseline.id}
              initial={{
                name: baseline.name,
                kind: baseline.kind as BaselineSetupKindValue,
                notes: baseline.notes ?? "",
                surface: baseline.surface ?? "",
                gripLevel: baseline.gripLevel ?? "",
                data: normalizeSetupData(baseline.data),
              }}
              startOptions={ctx.startOptions}
            />
          ) : (
            <CardPanel contentClassName="text-sm text-muted-foreground">
              This chassis has no parameter schema yet — build the sheet first.
            </CardPanel>
          )}
        </div>
      </section>
    </>
  );
}
