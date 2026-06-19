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
            Shared calibration profiles for PDF-to-canonical setup mapping. You can edit and delete
            calibrations you created{isAdmin ? "; as an admin you can manage any calibration" : ""}.
          </p>
        </div>
      </header>
      <section className="page-body">
        {calibrations.length === 0 ? (
          <CardPanel>
            <div className="text-sm text-muted-foreground">No calibrations saved yet.</div>
          </CardPanel>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {calibrations.map((c) => {
              const { formFields, textFields, regionFields, imageFields } = calibrationMappingCounts(
                normalizeCalibrationData(c.calibrationDataJson)
              );
              const canManage = canManageCalibration(user, c);
              return (
                <li key={c.id}>
                  <CardPanel contentClassName="px-4 py-3 flex items-center justify-between gap-2">
                  <div>
                    <div className="ui-title text-sm text-foreground normal-case">{c.name}</div>
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
                  </CardPanel>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
