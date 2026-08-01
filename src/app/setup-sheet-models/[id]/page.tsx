import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { prisma } from "@/lib/prisma";
import {
  calibrationMappingCounts,
  normalizeCalibrationData,
} from "@/lib/setupCalibrations/types";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { normalizeSetupData } from "@/lib/runSetup";
import {
  sortBaselineSetups,
  type BaselineSetupKindValue,
} from "@/lib/baselineSetups/baselineSetupShape";
import { ChassisBaselineList } from "@/components/baselineSetups/ChassisBaselineList";
import { CardPanel } from "@/components/ui/CardPanel";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Eyebrow } from "@/components/ui/panel";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { CreateCalibrationForModel } from "@/components/setup-sheet-models/CreateCalibrationForModel";
import { setCalibrationVerificationAction } from "./actions";

export default async function SetupSheetModelWorkbenchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <header className="page-header">
        <div>
          <h1 className="page-title">Chassis workbench</h1>
          <p className="page-subtitle">Database not configured.</p>
        </div>
      </header>
    );
  }

  const user = await requireCurrentUser();
  const isAdmin = isAuthAdminEmail(user.email);
  // Release audit 2026-08-01: the chassis workbench is founder tooling — admin only.
  if (!isAdmin) notFound();
  const { id } = await params;

  const model = await prisma.setupSheetModel.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      isAuthorized: true,
      schemaJson: true,
      defaultCalibration: {
        select: {
          id: true,
          name: true,
          sourceType: true,
          exampleDocumentId: true,
          calibrationDataJson: true,
        },
      },
      _count: { select: { cars: true, calibrations: true, setupDocuments: true } },
    },
  });
  if (!model) notFound();

  const schema = parseSetupSheetModelSchema(model.schemaJson);
  const calibration = model.defaultCalibration;
  const calData = calibration ? normalizeCalibrationData(calibration.calibrationDataJson) : null;
  const counts = calData ? calibrationMappingCounts(calData) : null;
  const verification = calData?.verification;
  const greenLitAt = verification?.greenLitAt ?? null;
  const isGreenLit = Boolean(greenLitAt);
  const recheckKeys = verification?.fieldsNeedingRecheck ?? [];
  const boxEditorHref = calibration?.exampleDocumentId
    ? `/setup-documents/${calibration.exampleDocumentId}/calibrate-image`
    : null;

  // Baselines are global — read them for everyone; only the controls are admin-gated.
  const baselines = sortBaselineSetups(
    (
      await prisma.baselineSetup.findMany({
        where: { setupSheetModelId: model.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          kind: true,
          notes: true,
          surface: true,
          gripLevel: true,
          data: true,
          _count: { select: { copies: true } },
        },
      })
    ).map((b) => ({ ...b, kind: b.kind as BaselineSetupKindValue }))
  );

  const recentDocs = await prisma.setupDocument.findMany({
    where: { setupSheetModelId: model.id },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: {
      id: true,
      originalFilename: true,
      parseStatus: true,
      importStatus: true,
      createdAt: true,
    },
  });

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/setup-sheet-models" />
          <div>
            <h1 className="page-title">Chassis workbench</h1>
            <p className="page-subtitle">
              {model.name} · <span className="font-mono">{model.slug}</span>
              {model.isAuthorized ? " · catalog" : " · unreviewed"}
            </p>
          </div>
        </div>
      </header>

      <section className="page-body space-y-3 pb-6">
        <CardPanel contentClassName="space-y-3">
          <Eyebrow>Calibration status</Eyebrow>
          {calibration ? (
            <>
              <div className="text-sm">
                <span className="font-semibold">{calibration.name}</span>{" "}
                <span className="text-xs text-muted-foreground">({calibration.sourceType})</span>
              </div>
              {counts ? (
                <div className="font-mono text-xs text-muted-foreground">
                  {counts.imageFields} image regions · {counts.formFields} PDF form ·{" "}
                  {counts.textFields} text · schema {schema?.fields.length ?? "?"} fields
                </div>
              ) : null}
              <div className="text-sm">
                {isGreenLit && greenLitAt ? (
                  <span className="text-emerald-300">
                    Verified — green-lit{" "}
                    <span className="font-mono text-xs">
                      {new Date(greenLitAt).toLocaleDateString()}
                    </span>
                    . Uploads for this chassis import silently.
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Not verified — uploads still go through flagged review. Run test reads below,
                    then green-light when every read is correct.
                  </span>
                )}
              </div>
              {recheckKeys.length > 0 ? (
                <div className="rounded-md border border-border bg-secondary px-3 py-2 text-xs">
                  <span className="font-semibold">{recheckKeys.length} fields need re-check</span>{" "}
                  <span className="text-muted-foreground">
                    (geometry changed after the green-light):
                  </span>{" "}
                  <span className="font-mono">{recheckKeys.slice(0, 12).join(", ")}</span>
                  {recheckKeys.length > 12 ? ` +${recheckKeys.length - 12} more` : ""}
                </div>
              ) : null}
              {isAdmin ? (
                <div className="flex flex-wrap gap-2">
                  <form action={setCalibrationVerificationAction}>
                    <input type="hidden" name="calibrationId" value={calibration.id} />
                    <input type="hidden" name="modelId" value={model.id} />
                    <input type="hidden" name="op" value={isGreenLit ? "revoke" : "green_light"} />
                    <Button type="submit" variant={isGreenLit ? "outline" : "primary"}>
                      {isGreenLit ? "Revoke green-light" : "Green-light this calibration"}
                    </Button>
                  </form>
                  {recheckKeys.length > 0 ? (
                    <form action={setCalibrationVerificationAction}>
                      <input type="hidden" name="calibrationId" value={calibration.id} />
                      <input type="hidden" name="modelId" value={model.id} />
                      <input type="hidden" name="op" value="clear_recheck" />
                      <Button type="submit" variant="outline">
                        Mark re-checked
                      </Button>
                    </form>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <CreateCalibrationForModel modelId={model.id} modelName={model.name} />
          )}
        </CardPanel>

        <CardPanel contentClassName="space-y-3">
          <Eyebrow>Edit</Eyebrow>
          <div className="flex flex-wrap gap-2">
            {calibration ? (
              <ButtonLink href={`/setup-calibrations/${calibration.id}`} variant="primary">
                Open mapping editor
              </ButtonLink>
            ) : null}
            {boxEditorHref ? (
              <ButtonLink href={boxEditorHref} variant="outline">
                Edit boxes on the blank
              </ButtonLink>
            ) : null}
            <ButtonLink href={`/setup-sheet-models/${model.id}/schema`} variant="outline">
              Arrange the setup sheet
            </ButtonLink>
          </div>
        </CardPanel>

        <ChassisBaselineList
          modelId={model.id}
          isAdmin={isAdmin}
          baselines={baselines.map((b) => ({
            id: b.id,
            name: b.name,
            kind: b.kind as BaselineSetupKindValue,
            notes: b.notes,
            surface: b.surface,
            gripLevel: b.gripLevel,
            valueCount: Object.keys(normalizeSetupData(b.data)).length,
            copyCount: b._count.copies,
          }))}
        />

        <CardPanel contentClassName="space-y-3">
          <Eyebrow>Test reads</Eyebrow>
          <p className="text-sm text-muted-foreground">
            Upload known filled sheets for this chassis at{" "}
            <Link href="/cars" className="text-accent hover:underline">
              /cars
            </Link>
            , then open each document below and compare every extracted value against the sheet.
            Green-light the calibration once 1–3 sheets read perfectly.
          </p>
          {recentDocs.length ? (
            <ul className="divide-y divide-border text-sm">
              {recentDocs.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <Link
                    href={`/setup-documents/${d.id}`}
                    className="min-w-0 truncate text-accent hover:underline"
                  >
                    {d.originalFilename}
                  </Link>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {d.parseStatus} · {new Date(d.createdAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No documents for this chassis yet.</p>
          )}
        </CardPanel>
      </section>
    </>
  );
}
