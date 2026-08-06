import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SetupSheetModelDeleteButton } from "@/components/setup-sheet-models/SetupSheetModelDeleteButton";
import { SetupSheetModelAuthorizeToggle } from "@/components/setup-sheet-models/SetupSheetModelAuthorizeToggle";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { normalizeSetupSheetModelName } from "@/lib/setupSheetModels/normalizeModelName";
import {
  recommendedSetupSheetModelIds,
  setupSheetModelPickerScore,
  type SetupSheetModelPickerRow,
} from "@/lib/setupSheetModels/pickerModels";
import { ensureAuthorizedSetupSheetCatalog } from "@/lib/setupSheetModels/seedAuthorizedCatalog";
import { canEditSetupSheetModel } from "@/lib/setupSheetModels/modelAccess";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { isAuthorizedCatalogSlug } from "@/lib/setupSheetModels/catalogSuppression";
import { CardPanel } from "@/components/ui/CardPanel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Eyebrow } from "@/components/ui/panel";
import { PageBackLink } from "@/components/ui/PageBackLink";

function countDuplicateGroups(models: SetupSheetModelPickerRow[]): number {
  const byNorm = new Map<string, number>();
  for (const m of models) {
    const key = normalizeSetupSheetModelName(m.name);
    if (!key) continue;
    byNorm.set(key, (byNorm.get(key) ?? 0) + 1);
  }
  return [...byNorm.values()].filter((n) => n > 1).length;
}

export default async function SetupSheetModelsPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/settings" />
            <div>
              <h1 className="page-title">Chassis types</h1>
              <p className="page-subtitle">Database not configured.</p>
            </div>
          </div>
        </header>
      </>
    );
  }

  const user = await requireCurrentUser();
  await ensureAuthorizedSetupSheetCatalog();
  const isAdmin = isAuthAdminEmail(user.email);
  // Release audit 2026-08-01: the chassis catalog + workbench are founder tooling. Drivers pick
  // a chassis inside the car wizard; hand-builders reach THEIR schema from the car page.
  if (!isAdmin) notFound();

  const rows = await prisma.setupSheetModel.findMany({
    orderBy: [{ isAuthorized: "desc" }, { name: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      isAuthorized: true,
      userId: true,
      createdAt: true,
      defaultCalibration: { select: { id: true, name: true } },
      cars: { select: { id: true, name: true }, orderBy: { name: "asc" }, take: 4 },
      calibrations: { select: { id: true, name: true }, orderBy: { name: "asc" }, take: 4 },
      _count: { select: { cars: true, calibrations: true, setupDocuments: true } },
    },
  });

  const pickerRows: SetupSheetModelPickerRow[] = rows.map((m) => ({
    id: m.id,
    name: m.name,
    slug: m.slug,
    carCount: m._count.cars,
    calibrationCount: m._count.calibrations,
    isAuthorized: m.isAuthorized,
  }));
  const recommendedIds = recommendedSetupSheetModelIds(pickerRows);
  const duplicateGroupCount = countDuplicateGroups(pickerRows);

  const normOrder = new Map<string, number>();
  let normIdx = 0;
  for (const m of rows) {
    const key = normalizeSetupSheetModelName(m.name);
    if (!normOrder.has(key)) normOrder.set(key, normIdx++);
  }
  const sorted = [...rows].sort((a, b) => {
    const na = normOrder.get(normalizeSetupSheetModelName(a.name)) ?? 0;
    const nb = normOrder.get(normalizeSetupSheetModelName(b.name)) ?? 0;
    if (na !== nb) return na - nb;
    return setupSheetModelPickerScore({
      id: b.id,
      name: b.name,
      slug: b.slug,
      carCount: b._count.cars,
      calibrationCount: b._count.calibrations,
    }) - setupSheetModelPickerScore({
      id: a.id,
      name: a.name,
      slug: a.slug,
      carCount: a._count.cars,
      calibrationCount: a._count.calibrations,
    });
  });

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/settings" />
          <div>
            <h1 className="page-title">Chassis types</h1>
            <p className="page-subtitle">
              One shared setup sheet per chassis (e.g. Mugen MTC3), used by every car of that type.
            </p>
          </div>
        </div>
      </header>

      <section className="page-body">
        {isAdmin ? (
          <CardPanel className="max-w-2xl">
            <Eyebrow>Add a chassis type</Eyebrow>
            <p className="ui-caption mt-1">
              Name the chassis and upload its blank setup sheet — then build the parameter list by
              clicking each box on the sheet and naming it yourself.
            </p>
            <ButtonLink href="/setup-sheet-models/new" className="mt-3 inline-flex text-sm">
              New chassis type
            </ButtonLink>
          </CardPanel>
        ) : null}

        {isAdmin && duplicateGroupCount > 0 ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            <div className="font-medium text-amber-200">Duplicate chassis names detected</div>
            <p className="mt-1 text-xs text-amber-100/90 max-w-3xl">
              Legacy rows share a name. Run{" "}
              <code className="font-mono text-[11px]">npx tsx scripts/dedupe-setup-sheet-models.ts</code>{" "}
              (dry-run first) to merge them; new duplicates can no longer be created.
            </p>
          </div>
        ) : null}

        {sorted.length === 0 ? (
          <CardPanel>
            <div className="text-sm text-muted-foreground">No chassis types yet.</div>
          </CardPanel>
        ) : (
          <SurfaceCard variant="panel" contentClassName="p-0">
          <ul className="divide-y divide-border">
            {sorted.map((m) => {
              const isRecommended = recommendedIds.has(m.id);
              const norm = normalizeSetupSheetModelName(m.name);
              const dupCount = pickerRows.filter(
                (r) => normalizeSetupSheetModelName(r.name) === norm
              ).length;
              const isGlobal = m.isAuthorized;
              const canManage = canEditSetupSheetModel(user, m);

              return (
                <li key={m.id} className="px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="ui-title text-sm text-foreground normal-case">{m.name}</div>
                      {isRecommended && dupCount > 1 ? (
                        <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-200">
                          Used in pickers
                        </span>
                      ) : null}
                      {isGlobal ? (
                        <span className="rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          Built-in
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">{m.slug}</div>
                    <div className="text-xs text-muted-foreground">
                      {m._count.cars} car{m._count.cars === 1 ? "" : "s"}
                      {" · "}
                      {m._count.calibrations} calibration{m._count.calibrations === 1 ? "" : "s"}
                      {" · "}
                      {m._count.setupDocuments} document{m._count.setupDocuments === 1 ? "" : "s"}
                      {" · "}
                      {new Date(m.createdAt).toLocaleDateString()}
                    </div>
                    {m.defaultCalibration ? (
                      <div className="text-xs text-muted-foreground">
                        Default calibration:{" "}
                        <Link
                          href={`/setup-calibrations/${m.defaultCalibration.id}`}
                          className="text-accent hover:underline"
                        >
                          {m.defaultCalibration.name}
                        </Link>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">No default calibration</div>
                    )}
                    {m.cars.length > 0 ? (
                      <div className="text-[11px] text-muted-foreground">
                        Cars: {m.cars.map((c) => c.name).join(", ")}
                        {m._count.cars > m.cars.length ? ` +${m._count.cars - m.cars.length} more` : ""}
                      </div>
                    ) : null}
                    {m.calibrations.length > 0 ? (
                      <div className="text-[11px] text-muted-foreground">
                        Calibrations:{" "}
                        {m.calibrations.map((c) => c.name).join(", ")}
                        {m._count.calibrations > m.calibrations.length
                          ? ` +${m._count.calibrations - m.calibrations.length} more`
                          : ""}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Link
                      href={`/setup-sheet-models/${m.id}`}
                      className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                    >
                      Workbench
                    </Link>
                    <Link
                      href={`/setup-sheet-models/${m.id}/schema`}
                      className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                    >
                      {canManage ? "Edit schema" : "View schema"}
                    </Link>
                    {isAdmin ? (
                      <SetupSheetModelAuthorizeToggle modelId={m.id} isAuthorized={m.isAuthorized} />
                    ) : null}
                    {canManage ? (
                      <SetupSheetModelDeleteButton
                        modelId={m.id}
                        modelName={m.name}
                        carCount={m._count.cars}
                        calibrationCount={m._count.calibrations}
                        documentCount={m._count.setupDocuments}
                        isCatalogEntry={isAuthorizedCatalogSlug(m.slug)}
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          </SurfaceCard>
        )}

      </section>
    </>
  );
}
