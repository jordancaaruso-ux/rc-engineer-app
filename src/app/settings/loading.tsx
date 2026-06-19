import { PageHeaderSkeleton } from "@/components/ui/PageSkeletons";
import { CardPanel } from "@/components/ui/CardPanel";

function Shimmer({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted/60 ${className ?? ""}`} />;
}

export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton subtitle />
      <section className="page-body max-w-2xl space-y-3">
        {[0, 1, 2].map((i) => (
          <CardPanel key={i}>
            <Shimmer className="mb-2 h-4 w-32" />
            <Shimmer className="h-10 w-full" />
          </CardPanel>
        ))}
      </section>
    </>
  );
}
