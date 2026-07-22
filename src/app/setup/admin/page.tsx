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
import { listPendingChassisTypeRequests } from "@/lib/setupSheetModels/chassisTypeRequests";
import { topAiSpenders } from "@/lib/aiUsage/ledger";

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
  const [calibrations, chassisRequests, spenders] = await Promise.all([
    prisma.setupSheetCalibration.findMany({
      where: calibrationsVisibleToUserWhere(user.id),
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, name: true, sourceType: true, createdAt: true },
    }),
    listPendingChassisTypeRequests(20),
    topAiSpenders(30, 10),
  ]);
  const totalAiCostUsd = spenders.reduce((sum, s) => sum + s.costUsd, 0);

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

        {/* Open signup makes these two the things that bite silently: an unheard chassis request,
            and an AI bill forming before Vercel tells you. */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <Eyebrow>Chassis type requests</Eyebrow>
            <Link
              href="/setup-sheet-models"
              className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted"
            >
              Add one
            </Link>
          </div>
          <SurfaceCard variant="panel" contentClassName="p-0">
            {chassisRequests.length === 0 ? (
              <div className="px-4 py-3 text-xs text-muted-foreground">No open requests.</div>
            ) : (
              <ul className="divide-y divide-border">
                {chassisRequests.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs text-foreground">{r.requestedName}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {r.requesterEmail ?? "unknown"} ·{" "}
                        {formatRunDateOnly(r.createdAt, displayTimeZone)}
                        {r.requestCount > 1 ? ` · asked ${r.requestCount}x` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SurfaceCard>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <Eyebrow>AI spend — last 30 days</Eyebrow>
            <span className="text-xs text-muted-foreground">
              ${totalAiCostUsd.toFixed(2)} est.
            </span>
          </div>
          <SurfaceCard variant="panel" contentClassName="p-0">
            {spenders.length === 0 ? (
              <div className="px-4 py-3 text-xs text-muted-foreground">No AI usage recorded.</div>
            ) : (
              <ul className="divide-y divide-border">
                {spenders.map((s) => (
                  <li key={s.userId} className="flex items-center justify-between gap-2 px-4 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs text-foreground">
                        {s.email ?? s.userId}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{s.calls} calls</div>
                    </div>
                    <div className="font-mono text-xs text-foreground">
                      ${s.costUsd.toFixed(2)}
                    </div>
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
