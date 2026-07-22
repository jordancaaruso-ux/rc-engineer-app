import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { prisma } from "@/lib/prisma";
import { CardPanel } from "@/components/ui/CardPanel";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { buildSetupSheetTemplateFromParsedSchema } from "@/lib/setupSheetModels/buildSetupSheetTemplate";
import { normalizeSetupData } from "@/lib/runSetup";
import { KitSetupEditorClient } from "@/components/setup-sheet-models/KitSetupEditorClient";

/**
 * Admin-only: enter the manufacturer's kit setup for a chassis, through the same sequential flow
 * drivers use. Drivers may then start their first setup pre-filled at kit instead of empty.
 */
export default async function KitSetupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <header className="page-header">
        <div>
          <h1 className="page-title">Kit setup</h1>
          <p className="page-subtitle">Database not configured.</p>
        </div>
      </header>
    );
  }

  const user = await requireCurrentUser();
  if (!isAuthAdminEmail(user.email)) notFound();
  const { id } = await params;

  const model = await prisma.setupSheetModel.findUnique({
    where: { id },
    select: { id: true, name: true, schemaJson: true, kitSetupJson: true },
  });
  if (!model) notFound();

  const schema = parseSetupSheetModelSchema(model.schemaJson);
  if (!schema) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href={`/setup-sheet-models/${id}`} />
            <h1 className="page-title">Kit setup</h1>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-2xl" contentClassName="text-sm text-muted-foreground">
            This chassis has no parameter schema yet — build the sheet first.
          </CardPanel>
        </section>
      </>
    );
  }

  const template = buildSetupSheetTemplateFromParsedSchema(model.id, model.name, schema, "setup");

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href={`/setup-sheet-models/${id}`} />
          <div className="min-w-0">
            <h1 className="page-title truncate">Kit setup</h1>
            <p className="page-subtitle truncate">{model.name}</p>
          </div>
        </div>
      </header>
      <section className="page-body">
        <div className="max-w-2xl">
          <KitSetupEditorClient
            modelId={model.id}
            modelName={model.name}
            template={template}
            initialValues={model.kitSetupJson ? normalizeSetupData(model.kitSetupJson) : {}}
            hasExisting={Boolean(model.kitSetupJson)}
          />
        </div>
      </section>
    </>
  );
}
