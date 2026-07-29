import type { ReactNode } from "react";
import Link from "next/link";
import { CalibrationDeleteButton } from "@/components/setup-documents/CalibrationDeleteButton";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import {
  calibrationsVisibleToUserWhere,
  canManageCalibration,
  isCalibrationAdmin,
} from "@/lib/setupCalibrations/calibrationAccess";
import { calibrationMappingCounts, normalizeCalibrationData } from "@/lib/setupCalibrations/types";
import { CardPanel } from "@/components/ui/CardPanel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { UnverifiedBadge } from "@/components/assets/CatalogVerifyControl";
import { CatalogVerifyToggleButton } from "@/components/assets/CatalogVerifyToggleButton";

export default async function SetupCalibrationsPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Setup calibrations</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
      </>
    );
  }
  const user = await requireCurrentUser();
  const isAdmin = isCalibrationAdmin(user);

  // Calibrations are an admin-only surface (founder decision 2026-07-14).
  if (!isAdmin) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/settings" />
            <div>
              <h1 className="page-title">Setup calibrations</h1>
              <p className="page-subtitle">Admin-only.</p>
            </div>
          </div>
        </header>
        <section className="page-body">
          <CardPanel contentClassName="text-sm text-muted-foreground">
            Setup calibrations are managed by admins. Your uploaded setup sheets are calibrated
            automatically — you don&rsquo;t need to touch this.
          </CardPanel>
        </section>
      </>
    );
  }

  const calibrations = await prisma.setupSheetCalibration.findMany({
    where: calibrationsVisibleToUserWhere(user.id),
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      sourceType: true,
      calibrationDataJson: true,
      createdAt: true,
      userId: true,
      communityShared: true,
      verifiedAt: true,
      setupSheetModelId: true,
      exampleDocumentId: true,
      setupSheetModel: { select: { name: true } },
    },
  });
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Setup calibrations</h1>
          <p className="page-subtitle">
            Shared calibration profiles for PDF-to-canonical setup mapping. Yours work for you
            immediately; a calibration is only auto-applied for other drivers once it&rsquo;s
            verified{isAdmin ? " (use Verify to bless one)" : ""}.
          </p>
        </div>
      </header>
      <section className="page-body">
        {calibrations.length === 0 ? (
          <CardPanel>
            <div className="text-sm text-muted-foreground">No calibrations saved yet.</div>
          </CardPanel>
        ) : (
          <SurfaceCard variant="panel" contentClassName="p-0">
          <ul className="divide-y divide-border">
            {calibrations.map((c) => {
              const { formFields, textFields, regionFields, imageFields } = calibrationMappingCounts(
                normalizeCalibrationData(c.calibrationDataJson)
              );
              const canManage = canManageCalibration(user, c);
              return (
                <li key={c.id} className="px-4 py-3 flex items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="ui-title text-sm text-foreground normal-case">{c.name}</div>
                      {!c.verifiedAt ? <UnverifiedBadge /> : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {c.setupSheetModel?.name
                        ? `Car type: ${c.setupSheetModel.name}`
                        : "Unlinked — not assigned to a car type"}
                      {" · "}
                      {c.sourceType} · {formFields} form · {textFields} text · {regionFields} region ·{" "}
                      {imageFields} image
                      {c.exampleDocumentId ? "" : " · no example PDF"}
                      {" · "}
                      {new Date(c.createdAt).toLocaleDateString()}
                      {!canManage && c.userId !== user.id ? " · view only" : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isAdmin ? (
                      <CatalogVerifyToggleButton
                        endpoint={`/api/setup-calibrations/${c.id}`}
                        verified={!!c.verifiedAt}
                      />
                    ) : null}
                    {canManage ? (
                      <CalibrationDeleteButton calibrationId={c.id} calibrationName={c.name} />
                    ) : null}
                    <Link
                      href={`/setup-calibrations/${c.id}`}
                      className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                    >
                      {canManage ? "Edit" : "View"}
                    </Link>
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
