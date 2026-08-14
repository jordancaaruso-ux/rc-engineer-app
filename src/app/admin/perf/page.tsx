import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { PERF_ENABLED } from "@/lib/perf/perfConfig";
import type { PerfEnv } from "@/lib/perf/perfQueries";
import {
  loadClientRollups,
  loadColdStartRollup,
  loadEnvCounts,
  loadPerfCounts,
  loadQueryRollups,
  loadRouteRollups,
  parseDaysParam,
  parseEnvParam,
} from "@/lib/perf/perfQueries";

export const dynamic = "force-dynamic";

const WINDOWS = [1, 7, 30] as const;
const ENVS: { key: PerfEnv; label: string }[] = [
  { key: "vercel", label: "prod" },
  { key: "local", label: "local" },
  { key: "all", label: "both" },
];

/**
 * Performance ranking — what is actually slow, from real usage on Jordan's own devices.
 *
 * Deliberately a table, not a dashboard: the job is to answer "what do I fix next" in
 * one glance and to show whether the last fix moved the number.
 *
 * Excluded from its own instrumentation via `shouldSkipPerf`. See docs/PERFORMANCE.md.
 */
export default async function AdminPerfPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; env?: string }>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <PerfShell days={7} env="vercel" envCounts={[]}>
        <CardPanel contentClassName="text-sm text-muted-foreground">
          Set DATABASE_URL in .env.
        </CardPanel>
      </PerfShell>
    );
  }

  const user = await requireCurrentUser();
  if (!isAuthAdminEmail(user.email)) notFound();

  const sp = await searchParams;
  const days = parseDaysParam(sp.days);
  // Defaults to production. Local and prod share this database, and `next dev` compiles
  // routes on demand — mixing them puts webpack time into the p95 and reads as a
  // production problem that does not exist.
  const env = parseEnvParam(sp.env);

  const [routes, queries, client, counts, coldStart, envCounts] = await Promise.all([
    loadRouteRollups(days, env),
    loadQueryRollups(days, env),
    loadClientRollups(days, env),
    loadPerfCounts(days, env),
    loadColdStartRollup(days, env),
    loadEnvCounts(days),
  ]);

  return (
    <PerfShell days={days} env={env} envCounts={envCounts}>
      {!PERF_ENABLED ? (
        <CardPanel contentClassName="text-sm text-muted-foreground">
          Instrumentation is <span className="type-machine">off</span> — set{" "}
          <span className="type-machine">PERF_INSTRUMENTATION=1</span> to record new samples.
          Anything below is historical.
        </CardPanel>
      ) : null}

      {counts.serverSamples === 0 && counts.clientSamples === 0 ? (
        <CardPanel contentClassName="text-sm text-muted-foreground">
          No samples in this window. Use the app for a while with{" "}
          <span className="type-machine">PERF_INSTRUMENTATION=1</span> set, then come back.
        </CardPanel>
      ) : null}

      <Section
        eyebrow="Cold vs warm"
        note="A big gap here means the wait is lambda boot, not your queries — no query change touches it"
        empty={coldStart.length === 0}
      >
        <Table headers={["Process state", "n", "p50", "p95"]}>
          {coldStart.map((row) => (
            <tr key={row.bucket} className="border-t border-border/60">
              <Cell className="text-[11px]">{row.bucket}</Cell>
              <Num>{row.samples}</Num>
              <Num>{ms(row.p50)}</Num>
              <Num emphasis>{ms(row.p95)}</Num>
            </tr>
          ))}
        </Table>
      </Section>

      <Section
        eyebrow="Server routes by p95"
        note={`${counts.serverSamples} samples · page totals include streaming, so treat them as an upper bound`}
        empty={routes.length === 0}
      >
        <Table headers={["Route", "n", "p50", "p75", "p95", "db", "q"]}>
          {routes.map((row) => (
            <tr key={`${row.kind}-${row.route}`} className="border-t border-border/60">
              <Cell className="max-w-[220px] truncate type-machine text-[11px]" title={row.route}>
                <span className="text-muted-foreground">{row.kind === "api" ? "api " : "page "}</span>
                {row.route}
              </Cell>
              <Num>{row.samples}</Num>
              <Num>{ms(row.p50)}</Num>
              <Num>{ms(row.p75)}</Num>
              <Num emphasis>{ms(row.p95)}</Num>
              <Num>{ms(row.avgDbMs)}</Num>
              <Num>{Math.round(row.avgQueries)}</Num>
            </tr>
          ))}
        </Table>
      </Section>

      <Section
        eyebrow="Slowest queries"
        note="Cumulative time across the top-5 slowest query of each request — what dominates slow requests"
        empty={queries.length === 0}
      >
        <Table headers={["Model", "Op", "n", "p95", "total"]}>
          {queries.map((row) => (
            <tr key={`${row.model}-${row.operation}`} className="border-t border-border/60">
              <Cell className="type-machine text-[11px]">{row.model}</Cell>
              <Cell className="type-machine text-[11px] text-muted-foreground">{row.operation}</Cell>
              <Num>{row.appearances}</Num>
              <Num emphasis>{ms(row.p95)}</Num>
              <Num>{ms(row.totalMs)}</Num>
            </tr>
          ))}
        </Table>
      </Section>

      <Section
        eyebrow="Client vitals (p75)"
        note={`${counts.clientSamples} samples · this is the ground truth for how a page feels`}
        empty={client.length === 0}
      >
        <Table headers={["Metric", "Route", "Platform", "n", "p75"]}>
          {client.map((row) => (
            <tr
              key={`${row.name}-${row.route}-${row.platform ?? ""}`}
              className="border-t border-border/60"
            >
              <Cell className="type-machine text-[11px]">{row.name}</Cell>
              <Cell className="max-w-[180px] truncate type-machine text-[11px]" title={row.route}>
                {row.route}
              </Cell>
              <Cell className="text-[11px] text-muted-foreground">{row.platform ?? "—"}</Cell>
              <Num>{row.samples}</Num>
              <Num emphasis>{row.name === "CLS" ? row.p75.toFixed(3) : ms(row.p75)}</Num>
            </tr>
          ))}
        </Table>
      </Section>
    </PerfShell>
  );
}

function PerfShell({
  days,
  env,
  envCounts,
  children,
}: {
  days: number;
  env: PerfEnv;
  envCounts: { env: string; samples: number }[];
  children: ReactNode;
}): ReactNode {
  const envLabel = env === "vercel" ? "Production" : env === "local" ? "Local dev" : "Both";
  const tally = envCounts.map((c) => `${c.samples} ${c.env}`).join(" · ");

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/setup/admin" />
          <div className="min-w-0">
            <h1 className="page-title">Performance</h1>
            <p className="page-subtitle">
              {envLabel} · last {days} day{days === 1 ? "" : "s"}.
            </p>
          </div>
        </div>
      </header>

      <section className="page-body max-w-2xl space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {WINDOWS.map((w) => (
            <Chip key={w} href={`/admin/perf?days=${w}&env=${env}`} active={w === days}>
              {w}d
            </Chip>
          ))}
          <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
          {ENVS.map((e) => (
            <Chip
              key={e.key}
              href={`/admin/perf?days=${days}&env=${e.key}`}
              active={e.key === env}
            >
              {e.label}
            </Chip>
          ))}
        </div>
        {tally ? (
          <p className="-mt-2 type-machine text-[10px] text-muted-foreground">
            in window: {tally}
          </p>
        ) : null}
        {children}
      </section>
    </>
  );
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-full border border-border bg-card px-3 py-1 type-machine text-[11px] text-foreground"
          : "rounded-full border border-border/60 px-3 py-1 type-machine text-[11px] text-muted-foreground"
      }
    >
      {children}
    </Link>
  );
}

function Section({
  eyebrow,
  note,
  empty,
  children,
}: {
  eyebrow: string;
  note: string;
  empty: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <CardPanel>
      <Eyebrow>{eyebrow}</Eyebrow>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{note}</p>
      {empty ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        // Wide tables scroll inside the card rather than pushing the page sideways at 390px.
        <div className="mt-3 -mx-1 overflow-x-auto">{children}</div>
      )}
    </CardPanel>
  );
}

function Table({ headers, children }: { headers: string[]; children: ReactNode }): ReactNode {
  return (
    <table className="w-full min-w-[420px] border-collapse text-left">
      <thead>
        <tr>
          {headers.map((header, index) => (
            <th
              key={header}
              className={`pb-1 type-machine text-[10px] uppercase tracking-wide text-muted-foreground ${
                index === 0 ? "text-left" : "text-right"
              }`}
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Cell({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}): ReactNode {
  return (
    <td className={`py-1.5 pr-2 align-top ${className ?? ""}`} title={title}>
      {children}
    </td>
  );
}

function Num({ children, emphasis }: { children: ReactNode; emphasis?: boolean }): ReactNode {
  return (
    <td
      className={`py-1.5 pl-2 text-right align-top type-machine text-[11px] tabular-nums ${
        emphasis ? "text-foreground" : "text-muted-foreground"
      }`}
    >
      {children}
    </td>
  );
}

function ms(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}`;
}
