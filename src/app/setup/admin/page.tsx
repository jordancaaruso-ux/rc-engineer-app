import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { prisma } from "@/lib/prisma";
import { formatRunDateOnly } from "@/lib/formatDate";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { calibrationsVisibleToUserWhere } from "@/lib/setupCalibrations/calibrationAccess";
import { CardPanel } from "@/components/ui/CardPanel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { Eyebrow } from "@/components/ui/panel";
import { PageBackLink } from "@/components/ui/PageBackLink";

/** Setup workbench — calibrations and dataset tooling, off the driver-facing "My setups" page. */
export default async function SetupAdminPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/cars" />
            <div>
              <h1 className="page-title">Setup tools</h1>
              <p className="page-subtitle">Database not configured.</p>
            </div>
          </div>
        </header>
        <section className="page-body">
          <CardPanel contentClassName="text-sm text-muted-foreground">
            Set DATABASE_URL in .env.
          </CardPanel>
        </section>
      </>
    );
  }

  const user = await requireCurrentUser();
  if (!isAuthAdminEmail(user.email)) notFound();

  const displayTimeZone = await getExplicitTimeZoneForRunFormatting();
  const calibrations = await prisma.setupSheetCalibration.findMany({
    where: calibrationsVisibleToUserWhere(user.id),
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, name: true, sourceType: true, createdAt: true },
  });

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/cars" />
          <div>
            <h1 className="page-title">Setup tools</h1>
            <p className="page-subtitle">Calibrations, imports, and dataset stats.</p>
          </div>
        </div>
      </header>

      <section className="page-body max-w-2xl">
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <Eyebrow>Setup calibrations</Eyebrow>
            <Link
              href="/setup-calibrations"
              className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted"
            >
              Manage
            </Link>
          </div>
          <SurfaceCard variant="panel" contentClassName="p-0">
            {calibrations.length === 0 ? (
              <div className="px-4 py-3 text-xs text-muted-foreground">
                No calibrations saved yet.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {calibrations.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs text-foreground">{c.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {c.sourceType} · {formatRunDateOnly(c.createdAt, displayTimeZone)}
                      </div>
                    </div>
                    <Link
                      href={`/setup-calibrations/${c.id}`}
                      className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
                    >
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SurfaceCard>
        </div>

        <CardPanel contentClassName="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Eyebrow>Tools</Eyebrow>
            <div className="text-xs text-muted-foreground">
              Compare setups or import many PDFs for a dataset.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/setup/comparison"
              className="rounded-md border border-border bg-muted/60 px-3 py-2 text-xs font-medium transition hover:bg-muted"
            >
              Setup comparison
            </Link>
            <Link
              href="/setup/bulk-import"
              className="rounded-md border border-border bg-muted/60 px-3 py-2 text-xs font-medium transition hover:bg-muted"
            >
              Bulk setup import
            </Link>
            <Link
              href="/setup-sheet-models"
              className="rounded-md border border-border bg-muted/60 px-3 py-2 text-xs font-medium transition hover:bg-muted"
            >
              Chassis types
            </Link>
            <Link
              href="/setup/aggregations-debug"
              className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs font-medium transition hover:bg-muted"
            >
              Aggregation stats (debug)
            </Link>
          </div>
        </CardPanel>
      </section>
    </>
  );
}
