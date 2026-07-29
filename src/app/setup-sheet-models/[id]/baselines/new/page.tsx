import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { CardPanel } from "@/components/ui/CardPanel";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { loadBaselineEditorContext } from "@/lib/baselineSetups/loadBaselineEditorContext";
import { BaselineSetupEditorClient } from "@/components/baselineSetups/BaselineSetupEditorClient";

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
        <div className="max-w-2xl">
          {ctx.template ? (
            <BaselineSetupEditorClient
              modelId={ctx.model.id}
              modelName={ctx.model.name}
              template={ctx.template}
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
