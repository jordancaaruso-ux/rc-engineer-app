import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { CardPanel } from "@/components/ui/CardPanel";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { loadBaselineEditorContext } from "@/lib/baselineSetups/loadBaselineEditorContext";
import {
  BaselineSetupEditorClient,
  type BaselineFillDraftResume,
} from "@/components/baselineSetups/BaselineSetupEditorClient";
import { getSetupFillDraftForModel } from "@/lib/setup/getSetupFillDraft";
import { buildSetupFillSteps, countAnsweredSetupFillSteps } from "@/lib/setup/setupFillOrder";
import { normalizeSetupData } from "@/lib/runSetup";

/**
 * Admin-only: publish a global baseline setup (kit / base / pro) against a chassis type. Drivers
 * see it on every car of that chassis and can copy it into their own library.
 */
export default async function NewBaselineSetupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <header className="page-header">
        <div>
          <h1 className="page-title">New baseline</h1>
          <p className="page-subtitle">Database not configured.</p>
        </div>
      </header>
    );
  }

  const user = await requireCurrentUser();
  if (!isAuthAdminEmail(user.email)) notFound();
  const { id } = await params;

  const ctx = await loadBaselineEditorContext(id);
  if (!ctx) notFound();

  // Only the create path can park a fill; the edit page always has a real row. Counts are
  // recomputed here against today's schema rather than trusting the client's last report.
  const draftRow = ctx.template ? await getSetupFillDraftForModel(user.id, ctx.model.id) : null;
  const fillDraft: BaselineFillDraftResume | null =
    draftRow && ctx.template
      ? (() => {
          const values = normalizeSetupData(draftRow.data);
          const steps = buildSetupFillSteps(ctx.template!);
          return {
            values,
            stepIndex: draftRow.stepIndex,
            pendingText: draftRow.pendingText,
            pendingStepKey: draftRow.pendingStepKey,
            name: draftRow.name,
            answeredCount: countAnsweredSetupFillSteps(steps, values),
            stepCount: steps.length,
            updatedAt: draftRow.updatedAt.toISOString(),
          };
        })()
      : null;

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href={`/setup-sheet-models/${id}`} />
          <div className="min-w-0">
            <h1 className="page-title truncate">New baseline</h1>
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
              startOptions={ctx.startOptions}
              fillDraft={fillDraft}
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
