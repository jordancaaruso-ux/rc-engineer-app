import type { ReactNode } from "react";
import Link from "next/link";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { formatRunSessionDisplay } from "@/lib/runSession";

export default async function SetupPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Setup</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
        <section className="page-body">
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Set DATABASE_URL in .env.
          </div>
        </section>
      </>
    );
  }

  const user = await getOrCreateLocalUser();
  const [documents, runs, calibrations] = await Promise.all([
    prisma.setupDocument.findMany({
      where: { userId: user.id, setupImportBatchId: null },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        originalFilename: true,
        parseStatus: true,
        createdAt: true,
        createdSetupId: true,
      },
    }),
    prisma.run.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        id: true,
        createdAt: true,
        sessionType: true,
        meetingSessionType: true,
        meetingSessionCode: true,
        car: { select: { name: true } },
        track: { select: { name: true } },
        event: { select: { name: true } },
      },
    }),
    prisma.setupSheetCalibration.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, name: true, sourceType: true, createdAt: true },
    }),
  ]);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Setup</h1>
          <p className="page-subtitle">One place for setup sheets, run setups, and calibration tools.</p>
        </div>
      </header>

      <section className="page-body space-y-4">
        <div className="rounded-lg border border-border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="ui-title text-sm text-muted-foreground">Tools</div>
            <div className="text-xs text-muted-foreground">Compare setups or import many PDFs for a dataset.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/setup/comparison"
              className="rounded-md border border-border bg-muted/60 px-3 py-2 text-xs font-medium hover:bg-muted transition"
            >
              Setup comparison
            </Link>
            <Link
              href="/setup/bulk-import"
              className="rounded-md border border-border bg-muted/60 px-3 py-2 text-xs font-medium hover:bg-muted transition"
            >
              Bulk setup import
            </Link>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <div className="ui-title text-xs uppercase tracking-wide text-muted-foreground">Downloaded setups</div>
            <Link href="/setup-documents" className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted">
              Open library
            </Link>
          </div>
          {documents.length === 0 ? (
            <div className="px-4 py-5 text-sm text-muted-foreground">No setup documents yet.</div>
          ) : (
            <div className="divide-y divide-border/60">
              {documents.slice(0, 8).map((doc) => (
                <div key={doc.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-foreground">{doc.originalFilename}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {new Date(doc.createdAt).toLocaleDateString()} · {doc.parseStatus}
                      {doc.createdSetupId ? " · setup created" : ""}
                    </div>
                  </div>
                  <Link href={`/setup-documents/${doc.id}`} className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted">
                    Review
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <div className="ui-title text-xs uppercase tracking-wide text-muted-foreground">Setups from runs</div>
            <Link href="/runs/history" className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted">
              Open analysis
            </Link>
          </div>
          {runs.length === 0 ? (
            <div className="px-4 py-5 text-sm text-muted-foreground">No runs saved yet.</div>
          ) : (
            <div className="divide-y divide-border/60">
              {runs.slice(0, 10).map((run) => (
                <div key={run.id} className="px-4 py-2.5 text-sm">
                  <div className="text-foreground">
                    {run.event?.name ? `${run.event.name} · ` : ""}
                    {run.track?.name ?? "—"} · {run.car?.name ?? "—"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {formatRunSessionDisplay({
                      sessionType: run.sessionType,
                      meetingSessionType: run.meetingSessionType,
                      meetingSessionCode: run.meetingSessionCode,
                      sessionLabel: null,
                    })}{" "}
                    · {new Date(run.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border/70 bg-muted/30">
          <div className="flex items-center justify-between border-b border-border/70 px-4 py-2">
            <div className="ui-title text-xs uppercase tracking-wide text-muted-foreground">
              Setup calibrations <span className="normal-case opacity-80">(advanced)</span>
            </div>
            <Link href="/setup-calibrations" className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted">
              Manage
            </Link>
          </div>
          {calibrations.length === 0 ? (
            <div className="px-4 py-4 text-xs text-muted-foreground">No calibrations saved yet.</div>
          ) : (
            <div className="divide-y divide-border/60">
              {calibrations.slice(0, 6).map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 px-4 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs text-foreground">{c.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {c.sourceType} · {new Date(c.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <Link href={`/setup-calibrations/${c.id}`} className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted">
                    Open
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
