import { notFound, redirect } from "next/navigation";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { canEditSetupSheetModel } from "@/lib/setupSheetModels/modelAccess";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { SetupSheetModelSchemaPageClient } from "@/components/setup-sheet-models/SetupSheetModelSchemaPageClient";
import { PageBackLink } from "@/components/ui/PageBackLink";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string }>;
};

export default async function SetupSheetModelSchemaPage({ params, searchParams }: Props) {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/setup-sheet-models" />
            <div>
              <h1 className="page-title">Chassis schema</h1>
              <p className="page-subtitle">Database not configured.</p>
            </div>
          </div>
        </header>
        <section className="page-body">
          <p className="text-sm text-muted-foreground">Database not configured.</p>
        </section>
      </>
    );
  }
  const user = await getAuthenticatedApiUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const sp = await searchParams;
  const returnTo = typeof sp.returnTo === "string" ? sp.returnTo.trim() : null;
  // Models are global — load by id only; edit rights are computed separately.
  const model = await prisma.setupSheetModel.findUnique({
    where: { id },
    select: { id: true, name: true, slug: true, schemaJson: true, userId: true, isAuthorized: true },
  });
  // Release audit 2026-08-01: schema viewing/editing is for admins and the creator of a
  // still-unauthorized model (the unknown-chassis hand-build path). Everyone else: not found.
  if (model && !canEditSetupSheetModel(user, model)) notFound();
  if (!model) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/setup-sheet-models" />
            <div>
              <h1 className="page-title">Chassis schema</h1>
              <p className="page-subtitle">Sheet model not found.</p>
            </div>
          </div>
        </header>
        <section className="page-body">
          <p className="text-sm text-destructive">Sheet model not found.</p>
        </section>
      </>
    );
  }

  const schema = parseSetupSheetModelSchema(model.schemaJson);
  if (!schema) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/setup-sheet-models" />
            <div>
              <h1 className="page-title">{model.name}</h1>
              <p className="page-subtitle">Invalid schema data.</p>
            </div>
          </div>
        </header>
        <section className="page-body">
          <p className="text-sm text-destructive">Invalid schema data.</p>
        </section>
      </>
    );
  }

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/setup-sheet-models" />
          <div>
            <h1 className="page-title">{model.name}</h1>
            <p className="page-subtitle tabular-nums text-xs">{model.slug}</p>
          </div>
        </div>
      </header>
      <section className="page-body max-w-6xl">
        <SetupSheetModelSchemaPageClient
          modelId={model.id}
          modelName={model.name}
          initialSchema={schema}
          returnTo={returnTo}
          canEdit={canEditSetupSheetModel(user, model)}
          isAdmin={isAuthAdminEmail(user.email)}
        />
      </section>
    </>
  );
}
