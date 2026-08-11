import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { prisma } from "@/lib/prisma";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { chassisFillsAsSheet, isPlaceholderLabel } from "@/lib/setupSheetModels/sheetPlan";
import { namedBoxCount } from "@/lib/setupSheetModels/applyBoxLabels";
import { BoxNamingSurface } from "@/components/setup-sheet-models/BoxNamingSurface";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { CardPanel } from "@/components/ui/CardPanel";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/**
 * Naming the boxes on a chassis whose sheet came out of a PDF.
 *
 * Admin only. Naming is the founder's job by decision, not by accident: drivers would never name
 * two hundred boxes uniformly enough to compare across cars, and one driver relabelling a chassis
 * would change it for everyone else using it.
 */
export default async function SetupSheetModelBoxesPage({ params }: Props): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/admin/review" />
            <div>
              <h1 className="page-title">Name the boxes</h1>
              <p className="page-subtitle">Database not configured.</p>
            </div>
          </div>
        </header>
        <section className="page-body">
          <CardPanel contentClassName="text-sm text-muted-foreground">Set DATABASE_URL in .env.</CardPanel>
        </section>
      </>
    );
  }

  const user = await getAuthenticatedApiUser();
  if (!user) redirect("/login");
  if (!isAuthAdminEmail(user.email)) notFound();

  const { id } = await params;
  const model = await prisma.setupSheetModel.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      schemaJson: true,
      derivedFromBlank: { select: { boxesJson: true, fillSurface: true } },
    },
  });
  if (!model) notFound();

  const schema = parseSetupSheetModelSchema(model.schemaJson);
  const drawable = chassisFillsAsSheet(model.derivedFromBlank);

  if (!schema || !drawable) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/admin/review" />
            <div>
              <h1 className="page-title">Name the boxes</h1>
              <p className="page-subtitle">{model.name}</p>
            </div>
          </div>
        </header>
        <section className="page-body">
          <CardPanel contentClassName="text-sm text-muted-foreground">
            This chassis has no sheet to draw, so there is nothing to tap. Edit its parameters in
            the schema editor instead.
          </CardPanel>
        </section>
      </>
    );
  }

  /*
   * A generated position label arrives EMPTY.
   *
   * "Box 41 · page 1, upper centre" is not a name, it is where to look — and it is already shown
   * as the placeholder in the bar. Sending it as the value would mean every box counted as named,
   * and the founder would have to clear two hundred of them to see what was left.
   */
  const initialLabels: Record<string, string> = {};
  for (const f of schema.fields) {
    initialLabels[f.key] = isPlaceholderLabel(f.displayLabel) ? "" : f.displayLabel;
  }

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/admin/review" />
          <div>
            <h1 className="page-title">Name the boxes</h1>
            <p className="page-subtitle">{model.name}</p>
          </div>
        </div>
      </header>
      <section className="page-body max-w-2xl">
        <BoxNamingSurface
          modelId={model.id}
          chassisName={model.name}
          initialLabels={initialLabels}
          boxCount={schema.fields.length}
          initialNamedCount={namedBoxCount(schema)}
        />
      </section>
    </>
  );
}
