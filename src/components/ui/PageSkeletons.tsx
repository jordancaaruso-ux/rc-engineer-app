import { CardPanel } from "@/components/ui/CardPanel";

function Shimmer({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted/60 ${className ?? ""}`} />;
}

export function PageHeaderSkeleton({ subtitle = false }: { subtitle?: boolean }) {
  return (
    <header className="page-header">
      <div className="min-w-0 space-y-2">
        <Shimmer className="h-5 w-32" />
        {subtitle ? <Shimmer className="h-3 w-48" /> : null}
      </div>
    </header>
  );
}

export function DashboardLoadingSkeleton() {
  return (
    <>
      <PageHeaderSkeleton />
      <section className="page-body flex max-w-3xl flex-col gap-4">
        <CardPanel>
          <Shimmer className="h-12 w-full" />
        </CardPanel>
        <CardPanel>
          <Shimmer className="mb-2 h-4 w-40" />
          <Shimmer className="h-24 w-full" />
        </CardPanel>
        <CardPanel>
          <Shimmer className="h-20 w-full" />
        </CardPanel>
      </section>
    </>
  );
}

export function SessionsLoadingSkeleton() {
  return (
    <>
      <PageHeaderSkeleton subtitle />
      <section className="page-body space-y-3">
        <CardPanel>
          <Shimmer className="h-10 w-full" />
        </CardPanel>
        {[0, 1, 2].map((i) => (
          <CardPanel key={i}>
            <Shimmer className="mb-2 h-4 w-48" />
            <Shimmer className="h-16 w-full" />
          </CardPanel>
        ))}
      </section>
    </>
  );
}

export function NewRunLoadingSkeleton() {
  return (
    <>
      <PageHeaderSkeleton subtitle />
      <section className="page-body max-w-3xl space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <CardPanel key={i}>
            <Shimmer className="mb-2 h-4 w-28" />
            <Shimmer className="h-10 w-full" />
          </CardPanel>
        ))}
      </section>
    </>
  );
}

export function EngineerLoadingSkeleton() {
  return (
    <>
      <PageHeaderSkeleton subtitle />
      <section className="page-body max-w-4xl space-y-4">
        <CardPanel>
          <Shimmer className="h-16 w-full" />
        </CardPanel>
        <Shimmer className="h-10 w-full rounded-lg" />
        <CardPanel>
          <Shimmer className="h-64 w-full" />
        </CardPanel>
      </section>
    </>
  );
}

export function HubLoadingSkeleton() {
  return (
    <>
      <PageHeaderSkeleton subtitle />
      <section className="page-body max-w-2xl space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-card/80 px-4 py-3.5">
            <Shimmer className="h-12 w-full" />
          </div>
        ))}
      </section>
    </>
  );
}
