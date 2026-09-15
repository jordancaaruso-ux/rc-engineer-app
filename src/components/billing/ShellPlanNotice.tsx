import { CardPanel } from "@/components/ui/CardPanel";
import { BRAND_DOMAIN } from "@/lib/brand/brandNames";

/**
 * What the join and billing pages show INSIDE the native shell: the plan, and where it is
 * managed. No prices, no checkout, no link — the app stores' rule for a subscription sold on
 * the web (see `lib/nativeShell.ts`).
 */
export function ShellPlanNotice({ tierLabel }: { tierLabel?: string | null }) {
  return (
    <>
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Subscription</h1>
        </div>
      </header>
      <section className="page-body max-w-2xl">
        <CardPanel>
          {tierLabel ? (
            <p className="text-sm font-semibold text-foreground">{tierLabel}</p>
          ) : null}
          <p className="mt-1 text-sm text-muted-foreground">Managed at {BRAND_DOMAIN}.</p>
        </CardPanel>
      </section>
    </>
  );
}
