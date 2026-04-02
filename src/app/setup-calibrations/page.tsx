import type { ReactNode } from "react";
import Link from "next/link";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { calibrationMappingCounts, normalizeCalibrationData } from "@/lib/setupCalibrations/types";

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
  const calibrations = await prisma.setupSheetCalibration.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, sourceType: true, calibrationDataJson: true, createdAt: true },
  });
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Setup calibrations</h1>
          <p className="page-subtitle">Versioned calibration profiles for PDF-to-canonical setup mapping.</p>
        </div>
      </header>
      <section className="page-body">
        <div className="rounded-lg border border-border bg-card divide-y divide-border/60">
          {calibrations.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">No calibrations saved yet.</div>
          ) : (
            calibrations.map((c) => {
              const { formFields, textFields, regionFields } = calibrationMappingCounts(
                normalizeCalibrationData(c.calibrationDataJson)
              );
              return (
                <div key={c.id} className="px-4 py-3 flex items-center justify-between gap-2">
                  <div>
                    <div className="ui-title text-sm text-foreground">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.sourceType} · {formFields} form · {textFields} text · {regionFields} region ·{" "}
                      {new Date(c.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <Link href={`/setup-calibrations/${c.id}`} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">
                    Open
                  </Link>
                </div>
              );
            })
          )}
        </div>
      </section>
    </>
  );
}

